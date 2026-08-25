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
import { provideMovement } from 'angular-movement';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideFileRouter(),
    provideHttpClient(withInterceptors([requestContextInterceptor])),
    provideClientHydration(withEventReplay()),
    provideMovement({
      duration: 260,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    }),
  ],
};
