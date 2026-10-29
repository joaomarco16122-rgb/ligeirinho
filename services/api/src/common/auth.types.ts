import { Role } from '@prisma/client';
export interface Actor {
  id: string;
  name: string;
  email: string;
  role: Role;
  cityId: string | null;
  establishmentId: string | null;
  courierId: string | null;
  mustChangePassword: boolean;
  sessionId: string;
  authProvider?: 'local' | 'supabase';
}
