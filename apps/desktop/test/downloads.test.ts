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

describe('Windows file rules (ROADMAP 6.1)', () => {
  it('makes names Windows can store as given, so the saved file is the one checked', () => {
    expect(safeFilename('a<b>c:d"e|f?g*h.txt')).toBe('a_b_c_d_e_f_g_h.txt');
    expect(safeFilename('setup.exe.')).toBe('setup.exe'); // Windows would drop the dot anyway: the check must see .exe
    expect(isRiskyToOpen(safeFilename('setup.exe. . '))).toBe(true);
    for (const reserved of ['CON', 'nul.txt', 'com1.log', 'LPT9', 'aux.tar.gz']) expect(safeFilename(reserved)).toBe(`_${reserved}`);
    expect(safeFilename('console.log')).toBe('console.log');
    const long = safeFilename('x'.repeat(300) + '.exe');
    expect(long.length).toBe(200);
    expect(isRiskyToOpen(long)).toBe(true); // shortened, extension kept
  });

  it('never offers to open what Windows would run or mount', () => {
    for (const f of ['a.lnk', 'b.URL', 'c.hta', 'd.reg', 'e.msix', 'f.appinstaller', 'g.iso', 'h.vhdx', 'i.ps1', 'j.settingcontent-ms', 'k.msc', 'l.cpl']) {
      expect(isRiskyToOpen(f), f).toBe(true);
    }
    for (const f of ['a.pdf', 'b.png', 'c.zip', 'd.txt', 'e.mp4']) expect(isRiskyToOpen(f), f).toBe(false);
  });
});
