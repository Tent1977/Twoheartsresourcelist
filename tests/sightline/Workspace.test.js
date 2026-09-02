'use strict';
const { Workspace, WORKSPACES } = require('../../src/sightline/Workspace');

describe('Workspace', () => {
  test('lists both organisations', () => {
    expect(Workspace.list().sort()).toEqual(['ABLE', 'VOA']);
  });

  test('accepts case-insensitive ids', () => {
    expect(new Workspace('able').id).toBe('ABLE');
    expect(new Workspace('voa').id).toBe('VOA');
  });

  test('rejects an unknown workspace', () => {
    expect(() => new Workspace('nope')).toThrow(/Unknown workspace/);
  });

  test('ABLE document palette is navy and gold with no neon', () => {
    const p = new Workspace('ABLE').documentPalette();
    expect(p.primary).toBe('#0A1B3D');
    expect(p.secondary).toBe('#C9A227');
  });

  test('VOA never borrows ABLE document colors', () => {
    const able = new Workspace('ABLE').documentPalette();
    const voa = new Workspace('VOA').documentPalette();
    expect(voa.primary).not.toBe(able.primary);
    expect(voa.secondary).not.toBe(able.secondary);
  });

  test('VOA palette is flagged as a placeholder pending the real brand', () => {
    expect(WORKSPACES.VOA.paletteIsPlaceholder).toBe(true);
    expect(WORKSPACES.ABLE.paletteIsPlaceholder).toBeUndefined();
  });

  test('document palettes are copies, not live references', () => {
    const ws = new Workspace('ABLE');
    ws.documentPalette().primary = '#FF0000';
    expect(ws.documentPalette().primary).toBe('#0A1B3D');
  });

  test('ui palette carries the neon accents', () => {
    expect(new Workspace('ABLE').uiPalette().accent).toBe('#00E5FF');
  });

  test('stamp marks ownership', () => {
    const ws = new Workspace('ABLE');
    expect(ws.stamp({ text: 'hi' })).toEqual({ text: 'hi', workspace: 'ABLE' });
  });

  test('assertOwns blocks a cross-org record', () => {
    const able = new Workspace('ABLE');
    expect(() => able.assertOwns({ workspace: 'VOA' })).toThrow(/bleed blocked/);
    expect(() => able.assertOwns({ workspace: 'ABLE' })).not.toThrow();
  });

  test('assertOwns blocks an unscoped record', () => {
    expect(() => new Workspace('ABLE').assertOwns({})).toThrow(/unscoped/);
  });

  test('assertOwns rejects a non-record', () => {
    expect(() => new Workspace('ABLE').assertOwns(null)).toThrow(/requires a record/);
  });

  test('ABLE header layout matches the document standard', () => {
    const ws = new Workspace('ABLE');
    expect(ws.logoCorner).toBe('top-left');
    expect(ws.titlePosition).toBe('top-center');
    expect(ws.signatureBlock).toBe('Lawrence Dodson, ABLE Member');
    expect(ws.contact).toContain('ableexperience.org');
  });
});
