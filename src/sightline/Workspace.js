/**
 * Workspace.js — hard partition between ABLE and VOA.
 *
 * Lawrence works for VOA and volunteers with ABLE. The two must never bleed
 * into each other: separate stores, separate projects, separate palettes,
 * separate exports. Cross-workspace access throws rather than silently
 * degrading, because a silent bleed is exactly the failure we are preventing.
 */

'use strict';

const UI_NEON = {
  // Interactive chrome only. Never used in an exported document.
  cyan: '#00E5FF',
  lime: '#7CFF3D',
  gold: '#FFC400',
  ink: '#050B1A',
};

const WORKSPACES = {
  ABLE: {
    id: 'ABLE',
    legalName: 'Advisory Board of Lived Experience',
    // Document palette is the brand standard: navy + gold. No neon, ever.
    document: { primary: '#0A1B3D', secondary: '#C9A227', rule: '#0A1B3D', body: '#111111' },
    ui: { accent: UI_NEON.cyan, ok: UI_NEON.lime, warn: UI_NEON.gold, ground: UI_NEON.ink },
    logoCorner: 'top-left',
    titlePosition: 'top-center',
    signatureBlock: 'Lawrence Dodson, ABLE Member',
    contact: ['ableexperience.org', 'ablelivingexperience.org@gmail.com'],
  },
  VOA: {
    id: 'VOA',
    legalName: 'Volunteers of America',
    // Deliberately NOT navy/gold. VOA's official palette has not been supplied;
    // this neutral steel set is a placeholder that is visibly not ABLE's.
    document: { primary: '#2E3944', secondary: '#6B7A8F', rule: '#2E3944', body: '#111111' },
    ui: { accent: '#39D0D8', ok: '#8AF0A8', warn: '#F0B429', ground: '#0D1216' },
    logoCorner: 'top-left',
    titlePosition: 'top-center',
    signatureBlock: null,
    contact: [],
    paletteIsPlaceholder: true,
  },
};

class Workspace {
  constructor(id) {
    const def = WORKSPACES[String(id).toUpperCase()];
    if (!def) throw new Error(`Unknown workspace: ${id}`);
    Object.assign(this, def);
    this.namespace = `sightline:${def.id}`;
  }

  /** Throw if a record from another workspace is about to cross the line. */
  assertOwns(record) {
    if (!record || typeof record !== 'object') {
      throw new Error('assertOwns requires a record');
    }
    if (record.workspace !== this.id) {
      throw new Error(
        `Workspace bleed blocked: ${record.workspace || 'unscoped'} record touched by ${this.id}`
      );
    }
    return true;
  }

  /** Stamp a record so it can never be mistaken for the other org's. */
  stamp(record) {
    return Object.assign({}, record, { workspace: this.id });
  }

  /** Palette for an exported document. Never returns neon. */
  documentPalette() {
    return Object.assign({}, this.document);
  }

  /** Palette for on-screen controls. Neon lives here and only here. */
  uiPalette() {
    return Object.assign({}, this.ui);
  }

  static list() {
    return Object.keys(WORKSPACES);
  }
}

module.exports = { Workspace, WORKSPACES, UI_NEON };
