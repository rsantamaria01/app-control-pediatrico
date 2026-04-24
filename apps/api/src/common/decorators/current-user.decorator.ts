import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { UserRole } from '@app/shared';

export interface AuthPrincipal {
  id: string;
  role: UserRole;
  email: string | null;
  phone: string | null;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as AuthPrincipal;
  },
);
