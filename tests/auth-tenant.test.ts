import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AccessError, ownerIdFromSession } from '../src/lib/auth';

test('cada cuenta verificada recibe su propio identificador de espacio de trabajo', () => {
  const first = ownerIdFromSession({ user: { id: 'neon-user-one', emailVerified: true } });
  const second = ownerIdFromSession({ user: { id: 'neon-user-two', emailVerified: true } });
  assert.equal(first, 'neon-user-one');
  assert.equal(second, 'neon-user-two');
  assert.notEqual(first, second);
});

test('una sesión ausente o sin correo verificado no puede abrir un espacio de trabajo', () => {
  assert.throws(() => ownerIdFromSession(null), (error: unknown) => error instanceof AccessError && error.status === 401);
  assert.throws(() => ownerIdFromSession({ user: { id: 'unverified-user', emailVerified: false } }), (error: unknown) => error instanceof AccessError && error.status === 403);
});
