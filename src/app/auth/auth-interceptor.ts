import {
  HttpErrorResponse,
  type HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { AuthClient } from './auth-client';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const router = inject(Router);
  const auth = inject(AuthClient);
  const apiRequest = request.url.startsWith('/api/');
  const requestWithCredentials = apiRequest
    ? request.clone({ withCredentials: true })
    : request;

  return next(requestWithCredentials).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        apiRequest &&
        !request.url.startsWith('/api/auth/')
      ) {
        auth.user.set(null);
        auth.loaded.set(true);
        void router.navigate(['/signin'], {
          queryParams: { redirect: router.url },
        });
      }

      return throwError(() => error);
    }),
  );
};
