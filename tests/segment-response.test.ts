import { describe, it, expect } from 'vitest';
import { MemoryPromptBuilder, TACSegmentResponse } from '@twilio/tac-core';
import { NOW, makeEvent } from './helpers/segment';

describe('TACSegmentResponse', () => {
  describe('buildPrompt()', () => {
    it('should return an empty string when there are no events', () => {
      const response = new TACSegmentResponse([]);

      expect(response.isEmpty).toBe(true);
      expect(response.buildPrompt({ now: NOW })).toBe('');
    });

    it('should render a track event with relative time and scalar properties', () => {
      const response = new TACSegmentResponse([
        makeEvent({
          event: 'Application Submitted',
          timestamp: '2026-11-09T10:00:00Z',
          properties: { product: 'Gold Card', amount: 5000, vip: true },
        }),
      ]);

      expect(response.buildPrompt({ now: NOW })).toBe(
        '## Recent Customer Activity\n' +
          '- Application Submitted — 2h ago (product: Gold Card, amount: 5000, vip: true)'
      );
    });

    it('should collapse repeated events into a count using the latest timestamp', () => {
      const response = new TACSegmentResponse([
        makeEvent({ event: 'Product Viewed', timestamp: '2026-11-09T11:30:00Z' }),
        makeEvent({ event: 'Product Viewed', timestamp: '2026-11-09T09:00:00Z' }),
        makeEvent({ event: 'Product Viewed', timestamp: '2026-11-08T09:00:00Z' }),
      ]);

      expect(response.buildPrompt({ now: NOW })).toBe(
        '## Recent Customer Activity\n- Product Viewed ×3 — 30m ago'
      );
    });

    it('should label page views by path and not repeat the path as a property', () => {
      const response = new TACSegmentResponse([
        makeEvent({
          type: 'page',
          timestamp: '2026-11-09T09:00:00Z',
          properties: { path: '/pricing', referrer: 'google' },
        }),
        makeEvent({
          type: 'page',
          timestamp: '2026-11-09T08:00:00Z',
          properties: { path: '/pricing', referrer: 'google' },
        }),
      ]);

      expect(response.buildPrompt({ now: NOW })).toBe(
        '## Recent Customer Activity\n- Viewed page /pricing ×2 — 3h ago (referrer: google)'
      );
    });

    it('should treat Profile API "Page Viewed" track events as page views', () => {
      const response = new TACSegmentResponse([
        makeEvent({
          event: 'Page Viewed',
          timestamp: '2026-11-09T09:00:00Z',
          properties: { page_name: 'Pricing', path: '/pricing', title: 'Pricing' },
        }),
        makeEvent({
          event: 'Page Viewed',
          timestamp: '2026-11-09T08:00:00Z',
          properties: { page_name: 'Pricing', path: '/pricing', title: 'Pricing' },
        }),
        makeEvent({ event: 'Screen Viewed', timestamp: '2026-11-09T07:00:00Z' }),
      ]);

      expect(response.buildPrompt({ now: NOW })).toBe(
        '## Recent Customer Activity\n' +
          '- Viewed page /pricing ×2 — 3h ago\n' +
          '- Viewed screen — 5h ago'
      );
    });

    it('should fall back to a generic label for page views without a target', () => {
      const response = new TACSegmentResponse([
        makeEvent({ type: 'screen', timestamp: '2026-11-09T11:59:59Z' }),
      ]);

      expect(response.buildPrompt({ now: NOW })).toContain('- Viewed screen — just now');
    });

    it('should skip identify calls', () => {
      const response = new TACSegmentResponse([
        makeEvent({ type: 'identify', timestamp: '2026-11-09T11:00:00Z', properties: { a: 1 } }),
      ]);

      expect(response.buildPrompt({ now: NOW })).toBe('');
    });

    it('should format days for older events', () => {
      const response = new TACSegmentResponse([
        makeEvent({ event: 'Signed Up', timestamp: '2026-11-04T12:00:00Z' }),
      ]);

      expect(response.buildPrompt({ now: NOW })).toContain('Signed Up — 5d ago');
    });

    it('should report an unparseable timestamp instead of NaN', () => {
      const response = new TACSegmentResponse([makeEvent({ event: 'X', timestamp: 'garbage' })]);

      expect(response.buildPrompt({ now: NOW })).toContain('X — unknown time');
    });

    it('should cap output at maxLines (default 10)', () => {
      const events = Array.from({ length: 15 }, (_, i) =>
        makeEvent({ event: `Event ${i}`, timestamp: '2026-11-09T11:00:00Z' })
      );
      const response = new TACSegmentResponse(events);

      expect(response.buildPrompt({ now: NOW }).split('\n')).toHaveLength(11);
      expect(response.buildPrompt({ now: NOW, maxLines: 3 }).split('\n')).toHaveLength(4);
    });

    it('should only show allowlisted properties when an allowlist is given', () => {
      const response = new TACSegmentResponse([
        makeEvent({
          event: 'Application Submitted',
          timestamp: '2026-11-09T11:00:00Z',
          properties: { product: 'Gold Card', ssn: '123-45-6789' },
        }),
      ]);

      const prompt = response.buildPrompt({ now: NOW, propertyAllowlist: ['product'] });

      expect(prompt).toContain('product: Gold Card');
      expect(prompt).not.toContain('ssn');
      expect(prompt).not.toContain('123-45-6789');
    });

    it('should omit the property list when nothing is allowlisted', () => {
      const response = new TACSegmentResponse([
        makeEvent({ event: 'X', timestamp: '2026-11-09T11:00:00Z', properties: { a: 'b' } }),
      ]);

      expect(response.buildPrompt({ now: NOW, propertyAllowlist: [] })).toBe(
        '## Recent Customer Activity\n- X — 1h ago'
      );
    });

    it('should drop nested values and truncate long scalars, capping at 5 properties', () => {
      const response = new TACSegmentResponse([
        makeEvent({
          event: 'X',
          timestamp: '2026-11-09T11:00:00Z',
          properties: {
            nested: { a: 1 },
            long: 'z'.repeat(100),
            p1: 1,
            p2: 2,
            p3: 3,
            p4: 4,
            p5: 5,
          },
        }),
      ]);

      const prompt = response.buildPrompt({ now: NOW });

      expect(prompt).not.toContain('nested');
      expect(prompt).toContain(`long: ${'z'.repeat(59)}…`);
      expect(prompt).toContain('p4: 4');
      expect(prompt).not.toContain('p5');
    });
  });
});

describe('MemoryPromptBuilder with Segment events', () => {
  const response = new TACSegmentResponse([
    makeEvent({ event: 'Application Submitted', timestamp: new Date().toISOString() }),
  ]);

  it('should build a prompt from Segment events alone', () => {
    const prompt = MemoryPromptBuilder.build(null, null, { segmentEvents: response });

    expect(prompt).toContain('# Customer Context');
    expect(prompt).toContain('## Recent Customer Activity');
    expect(prompt).toContain('Application Submitted');
  });

  it('should append the activity section via compose()', () => {
    const prompt = MemoryPromptBuilder.compose('You are helpful.', null, null, {
      segmentEvents: response,
    });

    expect(prompt.startsWith('You are helpful.\n\n# Customer Context')).toBe(true);
    expect(prompt).toContain('- Application Submitted');
  });

  it('should return only the system prompt when Segment events are empty', () => {
    const prompt = MemoryPromptBuilder.compose('You are helpful.', null, null, {
      segmentEvents: new TACSegmentResponse([]),
    });

    expect(prompt).toBe('You are helpful.');
  });

  it('should return an empty string for empty events and no prompt', () => {
    expect(
      MemoryPromptBuilder.build(null, null, { segmentEvents: new TACSegmentResponse([]) })
    ).toBe('');
  });

  it('should be unchanged when segmentEvents is null or absent', () => {
    expect(MemoryPromptBuilder.build(null, null, { segmentEvents: null })).toBe('');
    expect(MemoryPromptBuilder.compose('Base', null, null)).toBe('Base');
  });

  it('should forward segmentMaxLines and segmentPropertyAllowlist', () => {
    const many = new TACSegmentResponse([
      makeEvent({
        event: 'A',
        timestamp: new Date().toISOString(),
        properties: { k: 'v', s: 'x' },
      }),
      makeEvent({ event: 'B', timestamp: new Date().toISOString() }),
    ]);

    const prompt = MemoryPromptBuilder.build(null, null, {
      segmentEvents: many,
      segmentMaxLines: 1,
      segmentPropertyAllowlist: ['k'],
    });

    expect(prompt).toContain('- A');
    expect(prompt).toContain('k: v');
    expect(prompt).not.toContain('s: x');
    expect(prompt).not.toContain('- B');
  });
});
