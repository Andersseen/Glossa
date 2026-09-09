import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

export type AuthUser = {
  id: string;
  email?: string;
  name?: string;
  role?: 'admin' | 'editor' | 'viewer' | string;
};

@Injectable({ providedIn: 'root' })
export class AuthClient {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly user = signal<AuthUser | null>(null);
  readonly loaded = signal(false);

  async loadCurrentUser(): Promise<AuthUser | null> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ data: AuthUser }>('/api/auth/me'),
      );
      this.user.set(response.data);
      return response.data;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this.user.set(null);
        return null;
      }

      throw error;
    } finally {
      this.loaded.set(true);
    }
  }

  async signin(email: string, password: string): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<{ data: { user: AuthUser } }>('/api/auth/signin', {
        email,
        password,
      }),
    );
    this.user.set(response.data.user);
    this.loaded.set(true);
  }

  async logout(): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/logout', {}));
    document.cookie = 'forge_session=; Path=/; Max-Age=0; SameSite=Lax';
    this.user.set(null);
    this.loaded.set(true);
    await this.router.navigate(['/signin']);
  }
}
