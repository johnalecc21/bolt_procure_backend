import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Role } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { origenesPermitidos } from '../config/origenes';
import {
  SubastaService,
  AuctionViewer,
  IniciarOpciones,
} from './subasta.service';

interface SocketUser extends AuctionViewer {
  sub: string;
  role: Role;
}

interface JoinPayload {
  requerimientoId: string;
}
interface IniciarPayload extends IniciarOpciones {
  requerimientoId: string;
}
interface PujarPayload {
  requerimientoId: string;
  monto: number;
}
interface CerrarPayload {
  requerimientoId: string;
}

const CONTROL_ROLES = new Set<Role>([Role.COMPRADOR, Role.ADMIN_CLIENTE]);

// Decorator options are evaluated at module-load time, before Nest's DI
// container exists, so this can't go through ConfigService like main.ts's
// REST CORS does — read the same env var directly instead (actual auth is
// enforced by the verified Supabase token in the handshake regardless, this
// is defense in depth to match the REST origin restriction).
@WebSocketGateway({
  namespace: '/subasta',
  cors: {
    origin: origenesPermitidos(process.env.CORS_ORIGIN),
    credentials: true,
  },
})
export class SubastaGateway implements OnGatewayInit {
  @WebSocketServer() server: Server;

  private logger = new Logger(SubastaGateway.name);
  // One close timer per round on the instance that started it. If that
  // instance goes away, SubastaService.getState() closes the round on the next
  // read instead — the deadline is enforced by the database either way.
  private closeTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private subasta: SubastaService,
    private supabase: SupabaseService,
    private prisma: PrismaService,
  ) {}

  // Auth as a Socket.IO middleware (not the OnGatewayConnection lifecycle
  // hook) so it resolves BEFORE the client ever sees its 'connect' event —
  // the real frontend emits 'join' the instant it sees 'connect', which
  // otherwise races the async Supabase/Prisma lookups below and can reach
  // 'join'/'iniciar' before the socket's user is attached.
  afterInit(server: Server) {
    // Cross-instance broadcasting (server.in(room).fetchSockets()/emit() in
    // broadcastState() below) is handled by attaching the Redis adapter to
    // the root io.Server in main.ts (RedisIoAdapter) — a namespaced gateway's
    // `server` here is actually the Namespace, not the root Server, and
    // Namespace has no .adapter() method, so that has to happen at bootstrap
    // instead of in this hook.
    server.use((socket, next) => {
      this.authenticate(socket)
        .then((user) => {
          socket.data.user = user;
          next();
        })
        .catch((err: Error) => next(err));
    });
  }

  private async authenticate(socket: Socket): Promise<SocketUser> {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) throw new Error('no token');
    const { data, error } = await this.supabase.anon.auth.getUser(token);
    if (error || !data.user) throw new Error('invalid token');

    const profile = await this.prisma.user.findUnique({
      where: { id: data.user.id },
    });
    if (!profile || !profile.activo) throw new Error('inactive user');

    let companyId: string | undefined;
    let proveedorId: string | undefined;
    if (profile.portal === 'CLIENTE') {
      const membership = await this.prisma.companyMembership.findFirst({
        where: { userId: profile.id, activo: true },
        select: { companyId: true },
      });
      companyId = membership?.companyId;
    } else if (profile.portal === 'PROVEEDOR') {
      proveedorId = await this.subasta.proveedorIdForUser(profile.id);
    }

    return {
      sub: profile.id,
      portal: profile.portal,
      role: profile.role,
      companyId,
      proveedorId,
    };
  }

  @SubscribeMessage('join')
  async onJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: JoinPayload,
  ) {
    const user: SocketUser = client.data.user;
    const allowed = await this.subasta.canView(body.requerimientoId, user);
    if (!allowed) {
      client.emit('error', { message: 'No tienes acceso a esta subasta.' });
      return;
    }
    await client.join(body.requerimientoId);
    const state = await this.subasta.getState(body.requerimientoId);
    client.emit('state', this.subasta.buildView(state, user));
  }

  @SubscribeMessage('iniciar')
  async onIniciar(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: IniciarPayload,
  ) {
    const user: SocketUser = client.data.user;
    if (
      !CONTROL_ROLES.has(user.role) ||
      !(await this.subasta.canControl(body.requerimientoId, user))
    ) {
      client.emit('error', {
        message: 'No tienes permiso para iniciar esta subasta.',
      });
      return;
    }
    try {
      const state = await this.subasta.iniciar(body.requerimientoId, {
        duracionMin: Number(body.duracionMin),
        participantes: body.participantes === 'todos' ? 'todos' : 'finalistas',
      });
      await this.broadcastState(body.requerimientoId, state);
      if (state.deadline)
        this.scheduleClose(
          body.requerimientoId,
          state.deadline.getTime() - Date.now(),
        );
    } catch (err) {
      client.emit('error', { message: (err as Error).message });
    }
  }

  @SubscribeMessage('pujar')
  async onPujar(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: PujarPayload,
  ) {
    const user: SocketUser = client.data.user;
    if (user.portal !== 'PROVEEDOR' || !user.proveedorId) return;
    try {
      const state = await this.subasta.pujar(
        body.requerimientoId,
        user.proveedorId,
        body.monto,
      );
      await this.broadcastState(body.requerimientoId, state);
    } catch (err) {
      client.emit('error', { message: (err as Error).message });
    }
  }

  @SubscribeMessage('cerrar')
  async onCerrar(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: CerrarPayload,
  ) {
    const user: SocketUser = client.data.user;
    if (
      !CONTROL_ROLES.has(user.role) ||
      !(await this.subasta.canControl(body.requerimientoId, user))
    ) {
      client.emit('error', {
        message: 'No tienes permiso para cerrar esta subasta.',
      });
      return;
    }
    const state = await this.subasta.cerrar(body.requerimientoId);
    await this.broadcastState(body.requerimientoId, state);
    this.clearCloseTimer(body.requerimientoId);
  }

  private scheduleClose(requerimientoId: string, delayMs: number) {
    this.clearCloseTimer(requerimientoId);
    const timer = setTimeout(
      () => {
        this.closeTimers.delete(requerimientoId);
        void (async () => {
          if (!(await this.subasta.cerrarSiVencida(requerimientoId))) return;
          await this.broadcastState(
            requerimientoId,
            await this.subasta.getState(requerimientoId),
          );
        })().catch((err: Error) =>
          this.logger.error(
            `No se pudo cerrar la subasta ${requerimientoId}: ${err.message}`,
          ),
        );
      },
      Math.max(0, delayMs) + 250,
    );
    this.closeTimers.set(requerimientoId, timer);
  }

  private clearCloseTimer(requerimientoId: string) {
    const timer = this.closeTimers.get(requerimientoId);
    if (timer) {
      clearTimeout(timer);
      this.closeTimers.delete(requerimientoId);
    }
  }

  // Every socket in the room gets its own view of the same state — cliente
  // sockets get the real leaderboard, proveedor sockets get only their own
  // puja plus rank, computed server-side so the raw rival data never
  // reaches a proveedor's browser in the first place.
  private async broadcastState(
    requerimientoId: string,
    state: Awaited<ReturnType<SubastaService['getState']>>,
  ) {
    const sockets = await this.server.in(requerimientoId).fetchSockets();
    for (const socket of sockets) {
      const user = socket.data.user as SocketUser | undefined;
      if (!user) continue;
      socket.emit('state', this.subasta.buildView(state, user));
    }
  }
}
