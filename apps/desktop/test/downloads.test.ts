import { describe, expect, it } from 'vitest';
import { isRiskyToOpen, safeFilename, uniquePath } from '../src/main/downloads/files';

describe('safeFilename', () => {
  it('keeps normal names', () => {
    expect(safeFilename('report 2026.pdf')).toBe('report 2026.pdf');
  });

  it('drops directories, leading dots and control characters', () => {
    expect(safeFilename('../../.bashrc')).toBe('bashrc');
    expect(safeFilename('..\\..\\evil.txt')).toBe('evil.txt');
    expect(safeFilename('/etc/passwd')).toBe('passwd');
    expect(safeFilename('.hidden')).toBe('hidden');
    expect(safeFilename('a\u0000b\u001fc.txt')).toBe('abc.txt');
  });

  it('never returns an empty name', () => {
    for (const bad of ['', '..', '...', '/', '   ']) expect(safeFilename(bad)).toBe('download');
  });
});

describe('uniquePath', () => {
  const taken = (names: string[]) => (p: string) => names.includes(p);

  it('uses the name as-is when free', () => {
    expect(uniquePath('/home/u/Downloads', 'a.pdf', taken([]))).toBe('/home/u/Downloads/a.pdf');
  });

  it('numbers duplicates before the extension, never overwriting', () => {
    const exists = taken(['/d/a.pdf', '/d/a (1).pdf']);
    expect(uniquePath('/d', 'a.pdf', exists)).toBe('/d/a (2).pdf');
    expect(uniquePath('/d', 'notes', taken(['/d/notes']))).toBe('/d/notes (1)');
    expect(uniquePath('/d', 'x.tar.gz', taken(['/d/x.tar.gz']))).toBe('/d/x.tar (1).gz');
  });
});

describe('isRiskyToOpen', () => {
  it('flags files the desktop could run', () => {
    for (const f of ['app.desktop', 'install.sh', 'Tool.AppImage', 'setup.EXE', 'invoice.pdf.desktop', 'run.py']) {
      expect(isRiskyToOpen(f)).toBe(true);
    }
  });

  it('lets documents, media and archives open normally', () => {
    for (const f of ['a.pdf', 'b.png', 'c.mp4', 'd.zip', 'e.txt', 'f.docx', 'noextension']) {
      expect(isRiskyToOpen(f)).toBe(false);
    }
  });
});
