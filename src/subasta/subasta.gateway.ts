import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../supabase/supabase.service';
import { SubastaService, PujaSeed } from './subasta.service';

interface SocketUser {
  sub: string;
}

interface JoinPayload {
  requerimientoId: string;
}
interface IniciarPayload {
  requerimientoId: string;
  durationMs: number;
  seed: PujaSeed[];
}
interface PujarPayload {
  requerimientoId: string;
  monto: number;
}
interface CerrarPayload {
  requerimientoId: string;
}

@WebSocketGateway({ namespace: '/subasta', cors: { origin: '*' } })
export class SubastaGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

  private logger = new Logger(SubastaGateway.name);
  private intervals = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    private subasta: SubastaService,
    private supabase: SupabaseService,
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('no token');
      const { data, error } = await this.supabase.anon.auth.getUser(token);
      if (error || !data.user) throw new Error('invalid token');
      client.data.user = { sub: data.user.id } satisfies SocketUser;
    } catch {
      this.logger.warn(`Rejected unauthenticated socket ${client.id}`);
      client.disconnect(true);
    }
  }

  @SubscribeMessage('join')
  async onJoin(@ConnectedSocket() client: Socket, @MessageBody() body: JoinPayload) {
    await client.join(body.requerimientoId);
    const state = await this.subasta.getState(body.requerimientoId);
    client.emit('state', state);
  }

  @SubscribeMessage('iniciar')
  async onIniciar(@ConnectedSocket() client: Socket, @MessageBody() body: IniciarPayload) {
    const state = await this.subasta.iniciar(body.requerimientoId, body.durationMs, body.seed);
    this.server.to(body.requerimientoId).emit('state', state);
    this.scheduleTicks(body.requerimientoId, body.durationMs);
  }

  @SubscribeMessage('pujar')
  async onPujar(@ConnectedSocket() client: Socket, @MessageBody() body: PujarPayload) {
    const user: SocketUser = client.data.user;
    const proveedor = await this.prisma.proveedorProfile.findUnique({ where: { userId: user.sub } });
    if (!proveedor) return;
    try {
      const state = await this.subasta.pujar(body.requerimientoId, proveedor.id, body.monto);
      this.server.to(body.requerimientoId).emit('state', state);
    } catch (err) {
      client.emit('error', { message: (err as Error).message });
    }
  }

  @SubscribeMessage('cerrar')
  async onCerrar(@MessageBody() body: CerrarPayload) {
    const state = await this.subasta.cerrar(body.requerimientoId);
    this.server.to(body.requerimientoId).emit('state', state);
    this.clearTicks(body.requerimientoId);
  }

  private scheduleTicks(requerimientoId: string, durationMs: number) {
    this.clearTicks(requerimientoId);
    const interval = setInterval(async () => {
      const state = await this.subasta.nudge(requerimientoId);
      if (!state) {
        this.clearTicks(requerimientoId);
        return;
      }
      this.server.to(requerimientoId).emit('state', state);
    }, 5000);
    this.intervals.set(requerimientoId, interval);

    setTimeout(() => this.clearTicks(requerimientoId), durationMs + 1000);
  }

  private clearTicks(requerimientoId: string) {
    const interval = this.intervals.get(requerimientoId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(requerimientoId);
    }
  }
}
