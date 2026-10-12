import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  provideClientHydration,
  withEventReplay,
} from '@angular/platform-browser';
import { provideFileRouter, requestContextInterceptor } from '@analogjs/router';
import { provideEtyma } from '@etyma/angular';
import { provideMovement } from 'angular-movement';

import { authInterceptor } from './auth/auth-interceptor';
import { i18n } from './i18n/i18n';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideFileRouter(),
    provideHttpClient(
      withInterceptors([requestContextInterceptor, authInterceptor]),
    ),
    provideClientHydration(withEventReplay()),
    provideEtyma(i18n),
    provideMovement({
      duration: 260,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    }),
  ],
};
