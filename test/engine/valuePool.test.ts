import { describe, expect, it } from 'vitest';
import { ValuePool, resourceSegment } from '../../src/engine/generation/valuePool.js';

describe('ValuePool (build-prompt §35/§36)', () => {
  it('stores and returns the most-recent value; dedups', () => {
    const p = new ValuePool();
    p.put('id', 1);
    p.put('id', 2);
    p.put('id', 2);
    expect(p.get('id')).toBe(2);
    expect(p.has('id')).toBe(true);
    expect(p.has('missing')).toBe(false);
  });

  it('normalizes keys (case/punctuation-insensitive)', () => {
    const p = new ValuePool();
    p.put('userId', 'abc');
    expect(p.get('USER_ID')).toBe('abc');
    expect(p.get('userid')).toBe('abc');
  });

  it('harvests id fields from an array collection with resource scoping', () => {
    const p = new ValuePool();
    p.harvest([{ id: 1, name: 'a' }, { id: 2, name: 'b' }], '/users');
    expect(p.get('id')).toBe(2);
    expect(p.get('userId')).toBe(2); // resource-scoped: users -> user -> userId
    expect(p.get('usersId')).toBe(2);
  });

  it('harvests non-id scalar identifiers by exact name (key/slug)', () => {
    const p = new ValuePool();
    p.harvest([{ key: 'abc-123' }, { slug: 'hello' }], '/items');
    expect(p.get('key')).toBe('abc-123');
    expect(p.get('slug')).toBe('hello');
  });

  it('harvests from nested objects', () => {
    const p = new ValuePool();
    p.harvest({ data: { items: [{ id: 7 }] } }, '/orders');
    expect(p.get('id')).toBe(7);
    expect(p.get('orderId')).toBe(7);
  });

  it('resourceSegment picks the last static path segment', () => {
    expect(resourceSegment('/users/{id}')).toBe('users');
    expect(resourceSegment('/users/{id}/orders/{orderId}')).toBe('orders');
    expect(resourceSegment('/api/v1/products')).toBe('products');
  });
});
