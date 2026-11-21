import { dlopen, FFIType, ptr } from 'bun:ffi';

// The Markdown mark is the CC0 design by Dustin Curtis (github.com/dcurtis/markdown-mark).
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2b3445"/>
      <stop offset="1" stop-color="#0d1117"/>
    </linearGradient>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#background)"/>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="none" stroke="#3d444d" stroke-width="6"/>
  <g transform="translate(179 330) scale(3.2)" fill="#ffffff">
    <path d="M30 98V30h20l20 25 20-25h20v68H90V59L70 84 50 59v39zm125 0l-30-33h20V30h20v35h20z"/>
  </g>
  <circle cx="786" cy="262" r="62" fill="#3fb950" stroke="#0d1117" stroke-width="16"/>
</svg>`;

const OBJC = '/usr/lib/libobjc.A.dylib';
const APPKIT = '/System/Library/Frameworks/AppKit.framework/AppKit';

/**
 * Sets the icon that macOS shows for the app in the Dock and the Cmd+Tab switcher.
 * A compiled `mdlive` binary has no app bundle, so without this macOS shows the generic executable icon.
 * Does nothing on other platforms. Call it on the main thread, after the window is created.
 */
export const setAppIcon = (): void => {
  if (process.platform !== 'darwin') {
    return;
  }
  // objc_msgSend takes different arguments for each method, so each signature needs its own binding.
  const base = dlopen(OBJC, {
    objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
    sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr },
    objc_msgSend: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  }).symbols;
  const withBytes = dlopen(OBJC, {
    objc_msgSend: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.ptr },
  }).symbols;
  const withObject = dlopen(OBJC, {
    objc_msgSend: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
  }).symbols;
  // Loads AppKit for the NSImage and NSApplication classes. The symbol is only there because dlopen needs one.
  dlopen(APPKIT, { NSApplicationLoad: { args: [], returns: FFIType.bool } });

  const cls = (name: string) => base.objc_getClass(Buffer.from(`${name}\0`));
  const sel = (name: string) => base.sel_registerName(Buffer.from(`${name}\0`));
  const svg = Buffer.from(ICON_SVG);
  const data = withBytes.objc_msgSend(cls('NSData'), sel('dataWithBytes:length:'), ptr(svg), svg.length);
  const image = withObject.objc_msgSend(base.objc_msgSend(cls('NSImage'), sel('alloc')), sel('initWithData:'), data);
  if (image === null) {
    console.warn('mdlive: could not load the app icon');
    return;
  }
  const app = base.objc_msgSend(cls('NSApplication'), sel('sharedApplication'));
  withObject.objc_msgSend(app, sel('setApplicationIconImage:'), image);
};
