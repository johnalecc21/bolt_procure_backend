import { Injectable } from '@nestjs/common';
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { Observable } from 'rxjs';

type RequestConUsuario = {
  id?: string | number;
  method?: string;
  route?: { path?: string };
  user?: {
    sub?: string;
    email?: string;
    portal?: string;
    role?: string;
    companyId?: string;
  };
};

/**
 * Tags the error tracker's scope of the current request (Sentry isolates one
 * per request) with who made it, from which company and portal, and its
 * request id. Runs after the auth guard, so an unexpected error later in the
 * request reaches GlitchTip already saying whose it was.
 */
@Injectable()
export class ContextoSentryInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const req = context.switchToHttp().getRequest<RequestConUsuario>();
      const scope = Sentry.getIsolationScope();
      if (req.id !== undefined) scope.setTag('requestId', String(req.id));
      if (req.route?.path)
        scope.setTag('ruta', `${req.method ?? ''} ${req.route.path}`);
      if (req.user?.sub) {
        scope.setUser({ id: req.user.sub, email: req.user.email });
        if (req.user.companyId) scope.setTag('companyId', req.user.companyId);
        if (req.user.portal) scope.setTag('portal', req.user.portal);
        if (req.user.role) scope.setTag('rol', req.user.role);
      }
    }
    return next.handle();
  }
}
