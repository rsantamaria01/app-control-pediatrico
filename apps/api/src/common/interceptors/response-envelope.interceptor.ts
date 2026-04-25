import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import type { ApiResponse } from '@app/shared';

@Injectable()
export class ResponseEnvelopeInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data: unknown) => {
        if (
          data &&
          typeof data === 'object' &&
          ('data' in (data as Record<string, unknown>) ||
            'error' in (data as Record<string, unknown>))
        ) {
          return data as ApiResponse<T>;
        }
        return { data } as ApiResponse<T>;
      }),
    );
  }
}
