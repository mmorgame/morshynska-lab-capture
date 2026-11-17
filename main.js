const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  globalShortcut,
  dialog,
  shell,
  clipboard,
  nativeImage,
  screen,
  Tray,
  Menu
} = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const https = require('https');

app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');

let mainWindow = null;
let hudWindow = null;
let copyOverlayWindow = null;
let tray = null;
let isQuitting = false;

const USER_DATA_DIR = app.getPath('userData');
const CONFIG_PATH = path.join(USER_DATA_DIR, 'morshynska_config.json');

const DEFAULT_CONFIG = {
  videoDir: 'D:\\work\\VIDEO NVIDIA\\Morshynska_Captures',
  shotDir: 'D:\\work\\VIDEO NVIDIA\\Morshynska_Screenshots',
  outputFormat: 'video', // 'video' | 'webm' | 'gif'
  optimize: false,
  compression: 65,
  targetFps: 0,
  sysAudio: true,
  micAudio: true,
  selectedDisplayId: '',
  selectedMicDeviceId: 'default',
  autoStartWindows: false,
  showFpsOverlay: false,
  watermarkEnabled: false,
  watermarkPath: '',
  watermarkDataUrl: '',
  watermarkPos: 'bottom-right', // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
  watermarkOpacity: 80, // 5..100
  watermarkScale: 18, // % of width (5..50)
  onboardingCompleted: false,
  githubRepo: 'mmorgame/morshynska-lab-capture',
  githubToken: '',
  hotkeys: {
    record: 'F9',
    region: 'F8',
    screenshot: 'F10',
    copy: 'CommandOrControl+F10'
  }
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return {
        ...DEFAULT_CONFIG,
        ...raw,
        hotkeys: { ...DEFAULT_CONFIG.hotkeys, ...(raw.hotkeys || {}) }
      };
    }
  } catch (e) {}
  return { ...DEFAULT_CONFIG };
}

function saveConfig(partial) {
  const current = loadConfig();
  const updated = {
    ...current,
    ...partial,
    hotkeys: { ...current.hotkeys, ...(partial.hotkeys || {}) }
  };
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (e) {}
  return updated;
}

let appConfig = loadConfig();

function getFfmpegPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'bin', 'ffmpeg.exe'),
    path.join(__dirname, 'bin', 'ffmpeg.exe'),
    'D:\\backup work\\VIDEO COMPRESSOR\\compresso_ffmpeg.exe'
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return 'ffmpeg';
}

function ensureDirs() {
  try {
    if (appConfig.videoDir) fs.mkdirSync(appConfig.videoDir, { recursive: true });
    if (appConfig.shotDir) fs.mkdirSync(appConfig.shotDir, { recursive: true });
  } catch (e) {}
}

function getTargetDisplay() {
  const displays = screen.getAllDisplays();
  if (appConfig.selectedDisplayId) {
    const found = displays.find(d => String(d.id) === String(appConfig.selectedDisplayId));
    if (found) return found;
  }
  return screen.getPrimaryDisplay();
}

function createHudWindow() {
  const disp = getTargetDisplay();
  const { x, y, width } = disp.bounds;

  hudWindow = new BrowserWindow({
    width: 220,
    height: 76,
    x: x + Math.max(0, width - 224),
    y: y + 10,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // CRITICAL: Exclude HUD & FPS overlay from video recordings & screenshots (WDA_EXCLUDEFROMCAPTURE)
  hudWindow.setContentProtection(true);
  hudWindow.setIgnoreMouseEvents(true, { forward: true });
  hudWindow.setAlwaysOnTop(true, 'screen-saver');
  hudWindow.loadFile(path.join(__dirname, 'renderer', 'hud.html'));
}

function repositionHudWindow() {
  if (!hudWindow || hudWindow.isDestroyed()) return;
  const disp = getTargetDisplay();
  const { x, y, width } = disp.bounds;
  hudWindow.setPosition(x + Math.max(0, width - 224), y + 10);
}

function createCopyOverlayWindow() {
  const disp = getTargetDisplay();
  const { x, y, width, height } = disp.bounds;

  copyOverlayWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    fullscreen: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  copyOverlayWindow.setContentProtection(true);
  copyOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
  copyOverlayWindow.loadFile(path.join(__dirname, 'renderer', 'copy_overlay.html'));
}

function createMainWindow() {
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 835,
    useContentSize: true,
    frame: false,
    transparent: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#060B16',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Clicking X or pressing Alt+F4 ALWAYS minimizes to tray; only Tray right-click -> "Выход" quits!
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createSystemTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  if (!fs.existsSync(iconPath)) return;

  tray = new Tray(iconPath);
  tray.setToolTip('Morshynska Lab — Capture Studio');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Открыть Morshynska Lab',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Запись / Стоп',
      click: () => mainWindow && mainWindow.webContents.send('global-action', { action: 'record' })
    },
    {
      label: 'Скриншот',
      click: () => mainWindow && mainWindow.webContents.send('global-action', { action: 'screenshot' })
    },
    {
      label: 'COPY область',
      click: () => launchCopyOverlay()
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) mainWindow.focus();
      else mainWindow.show();
    }
  });
}

let rebindTargetAction = null;
let rebindCooldownUntil = 0;

function registerAllHotkeys() {
  globalShortcut.unregisterAll();
  const hk = appConfig.hotkeys || DEFAULT_CONFIG.hotkeys;

  const safeReg = (accel, fn) => {
    if (!accel) return;
    try {
      globalShortcut.register(accel, () => {
        if (rebindTargetAction || Date.now() < rebindCooldownUntil) return;
        fn();
      });
    } catch (e) {
      console.error('Hotkey register failed:', accel, e.message);
    }
  };

  safeReg(hk.record, () => {
    if (mainWindow) mainWindow.webContents.send('global-action', { action: 'record' });
  });
  safeReg(hk.region, () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('global-action', { action: 'region' });
    }
  });
  safeReg(hk.screenshot, () => {
    if (mainWindow) mainWindow.webContents.send('global-action', { action: 'screenshot' });
  });
  safeReg(hk.copy, () => {
    launchCopyOverlay();
  });
}

async function launchCopyOverlay() {
  try {
    const disp = getTargetDisplay();
    const scaleFactor = disp.scaleFactor || 1;
    const w = Math.round(disp.bounds.width * scaleFactor);
    const h = Math.round(disp.bounds.height * scaleFactor);

    if (!copyOverlayWindow || copyOverlayWindow.isDestroyed()) {
      createCopyOverlayWindow();
    } else {
      copyOverlayWindow.setBounds(disp.bounds);
    }

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: w, height: h },
      fetchWindowIcons: false
    });
    if (!sources || !sources.length) return;

    const matchSrc = sources.find(s => String(s.display_id) === String(disp.id)) || sources[0];
    // Fast raw BGRA bitmap (zero PNG compression lag!)
    const size = matchSrc.thumbnail.getSize();
    const bgraBuffer = matchSrc.thumbnail.toBitmap();

    copyOverlayWindow.webContents.send('init-screenshot-raw', {
      bgra: bgraBuffer,
      width: size.width,
      height: size.height
    });
    copyOverlayWindow.show();
    copyOverlayWindow.focus();
  } catch (err) {
    console.error('launchCopyOverlay error:', err);
  }
}

let tempWebmPath = '';
let tempWriteStream = null;

function runFfmpeg(args) {
  return new Promise((resolve) => {
    const bin = getFfmpegPath();
    const proc = spawn(bin, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      resolve({ ok: code === 0, code, stderr });
    });
    proc.on('error', (err) => {
      resolve({ ok: false, code: -1, stderr: err.message });
    });
  });
}

function getTimestampStamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

// IPC Handlers
ipcMain.handle('get-displays', () => {
  const all = screen.getAllDisplays();
  const primaryId = screen.getPrimaryDisplay().id;
  return all.map((d, idx) => {
    const sf = d.scaleFactor || 1;
    const w = Math.round(d.bounds.width * sf);
    const h = Math.round(d.bounds.height * sf);
    return {
      id: String(d.id),
      isPrimary: d.id === primaryId,
      width: w,
      height: h,
      label: `Монитор ${idx + 1} — ${w}×${h}${d.id === primaryId ? ' (Основной)' : ''}`
    };
  });
});

ipcMain.handle('get-config', () => {
  const disp = getTargetDisplay();
  const scaleFactor = disp.scaleFactor || 1;
  return {
    ...appConfig,
    displayWidth: Math.round(disp.bounds.width * scaleFactor),
    displayHeight: Math.round(disp.bounds.height * scaleFactor),
    version: app.getVersion()
  };
});

ipcMain.handle('save-config', (_e, partial) => {
  appConfig = saveConfig(partial);
  ensureDirs();
  repositionHudWindow();
  if (hudWindow && !hudWindow.isDestroyed() && typeof partial.showFpsOverlay === 'boolean') {
    hudWindow.webContents.send('hud-fps-toggle', {
      showFps: appConfig.showFpsOverlay,
      fpsLabel: appConfig.targetFps === 0 ? 'MAX ∞ FPS' : `${appConfig.targetFps} FPS`
    });
  }
  return appConfig;
});

ipcMain.handle('set-auto-start', (_e, enabled) => {
  appConfig = saveConfig({ autoStartWindows: !!enabled });
  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      path: process.execPath
    });
  } catch (e) {}
  return appConfig.autoStartWindows;
});

ipcMain.handle('select-watermark-image', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Выбери изображение для водяного знака',
    filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    properties: ['openFile']
  });
  if (!res.canceled && res.filePaths && res.filePaths[0]) {
    const filePath = res.filePaths[0];
    const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'png';
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const b64 = fs.readFileSync(filePath).toString('base64');
    const dataUrl = `data:${mime};base64,${b64}`;
    appConfig = saveConfig({
      watermarkPath: filePath,
      watermarkDataUrl: dataUrl,
      watermarkEnabled: true
    });
    return { path: filePath, dataUrl };
  }
  return null;
});

function commitRebindAccelerator(action, accelerator) {
  rebindTargetAction = null;
  rebindCooldownUntil = Date.now() + 900;
  globalShortcut.unregisterAll();
  const newHotkeys = { ...(appConfig.hotkeys || {}), [action]: accelerator };
  appConfig = saveConfig({ hotkeys: newHotkeys });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hotkey-rebound', { action, accelerator });
  }
  setTimeout(() => {
    if (!rebindTargetAction) {
      registerAllHotkeys();
    }
  }, 650);
  return appConfig.hotkeys;
}

ipcMain.handle('begin-rebind-capture', (_e, action) => {
  rebindTargetAction = action || null;
  globalShortcut.unregisterAll();
  if (!rebindTargetAction) {
    registerAllHotkeys();
    return false;
  }
  // Intercept PrintScreen and modifier+PrintScreen at the OS level so Windows Snipping Tool doesn't swallow it!
  const prtVariants = [
    'PrintScreen',
    'CommandOrControl+PrintScreen',
    'Alt+PrintScreen',
    'Shift+PrintScreen'
  ];
  for (const accel of prtVariants) {
    try {
      globalShortcut.register(accel, () => {
        if (rebindTargetAction) {
          commitRebindAccelerator(rebindTargetAction, accel);
        }
      });
    } catch (e) {}
  }
  return true;
});

ipcMain.handle('rebind-hotkey', (_e, { action, accelerator }) => {
  return commitRebindAccelerator(action, accelerator);
});

ipcMain.handle('get-capture-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false
  });
  const list = [];
  for (const s of sources) {
    const isScreen = s.id.startsWith('screen:');
    const name = (s.name || '').trim();
    if (!name) continue;
    if (name === 'Morshynska Lab — Capture Studio' || name.includes('hud.html') || name.includes('copy_overlay.html')) {
      continue;
    }
    list.push({
      id: s.id,
      displayId: String(s.display_id || ''),
      name,
      isScreen,
      label: isScreen ? `Весь экран — ${name}` : name
    });
  }
  return list;
});

ipcMain.handle('select-folder', async (_e, kind) => {
  const defaultPath = kind === 'video' ? appConfig.videoDir : appConfig.shotDir;
  const res = await dialog.showOpenDialog(mainWindow, {
    title: kind === 'video' ? 'Выбери папку для сохранения записей' : 'Выбери папку для скриншотов',
    defaultPath: fs.existsSync(defaultPath) ? defaultPath : undefined,
    properties: ['openDirectory', 'createDirectory']
  });
  if (!res.canceled && res.filePaths && res.filePaths[0]) {
    return res.filePaths[0];
  }
  return null;
});

ipcMain.handle('open-folder', async (_e, folderPath) => {
  try {
    if (folderPath) {
      fs.mkdirSync(folderPath, { recursive: true });
      await shell.openPath(folderPath);
    }
  } catch (e) {}
});

ipcMain.handle('start-recording-session', async () => {
  ensureDirs();
  const tmpDir = app.getPath('temp');
  tempWebmPath = path.join(tmpDir, `morshynska_raw_${Date.now()}.webm`);
  tempWriteStream = fs.createWriteStream(tempWebmPath);
  return { ok: true };
});

ipcMain.handle('save-recording-chunk', async (_e, arrayBuffer) => {
  if (tempWriteStream && arrayBuffer) {
    tempWriteStream.write(Buffer.from(arrayBuffer));
  }
  return true;
});

ipcMain.handle('finalize-recording-session', async (_e, opts) => {
  if (tempWriteStream) {
    await new Promise((r) => tempWriteStream.end(r));
    tempWriteStream = null;
  }
  if (!tempWebmPath || !fs.existsSync(tempWebmPath)) {
    return { ok: false };
  }

  const fmt = (opts && opts.outputFormat) || appConfig.outputFormat || 'video';
  const optimize = !!(opts && opts.optimize);
  const comp = typeof opts?.compression === 'number' ? opts.compression : 65;
  const outDir = (opts && opts.videoDir) || appConfig.videoDir;
  fs.mkdirSync(outDir, { recursive: true });

  const stamp = getTimestampStamp();
  let ext = '.mp4';
  if (fmt === 'webm') ext = '.webm';
  else if (fmt === 'gif') ext = '.gif';

  const fileName = `Morshynska_${stamp}${ext}`;
  const finalPath = path.join(outDir, fileName);

  let ffRes = { ok: false };

  if (fmt === 'video') {
    const cq = optimize ? Math.round(16 + (comp / 100) * 19) : 16;
    ffRes = await runFfmpeg([
      '-y',
      '-i', tempWebmPath,
      '-c:v', 'h264_nvenc',
      '-rc', 'vbr',
      '-cq', String(cq),
      '-preset', 'p4',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', optimize ? '128k' : '192k',
      '-movflags', '+faststart',
      finalPath
    ]);
    if (!ffRes.ok) {
      ffRes = await runFfmpeg([
        '-y',
        '-i', tempWebmPath,
        '-c:v', 'libx264',
        '-crf', String(cq),
        '-preset', 'veryfast',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        finalPath
      ]);
    }
  } else if (fmt === 'webm') {
    const crf = (!optimize || comp === 0) ? 18 : Math.round(20 + (comp / 100) * 24);
    ffRes = await runFfmpeg([
      '-y',
      '-i', tempWebmPath,
      '-c:v', 'libvpx-vp9',
      '-b:v', '0',
      '-crf', String(crf),
      '-row-mt', '1',
      '-deadline', (!optimize || comp === 0) ? 'realtime' : 'good',
      '-cpu-used', '3',
      finalPath
    ]);
  } else if (fmt === 'gif') {
    const fps = optimize && comp > 50 ? 15 : 20;
    const maxColors = optimize ? Math.max(64, Math.round(256 - (comp / 100) * 160)) : 256;
    const filter = `fps=${fps},split[s0][s1];[s0]palettegen=max_colors=${maxColors}[p];[s1][p]paletteuse=dither=bayer`;
    ffRes = await runFfmpeg([
      '-y',
      '-i', tempWebmPath,
      '-vf', filter,
      finalPath
    ]);
  }

  try { fs.unlinkSync(tempWebmPath); } catch (e) {}
  return { ok: ffRes.ok, filePath: finalPath, fileName };
});

ipcMain.handle('save-screenshot-file', async (_e, payload) => {
  const { dataUrl, outputFormat, optimize, compression, shotDir } = payload;
  const outDir = shotDir || appConfig.shotDir;
  fs.mkdirSync(outDir, { recursive: true });

  const stamp = getTimestampStamp();
  const isWebp = outputFormat === 'webm';
  const ext = isWebp ? '.webp' : '.png';
  const fileName = `Shot_${stamp}${ext}`;
  const finalPath = path.join(outDir, fileName);

  const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  const rawBuf = Buffer.from(base64Data, 'base64');

  try {
    const img = nativeImage.createFromBuffer(rawBuf);
    clipboard.writeImage(img);
  } catch (e) {}

  if (!isWebp && (!optimize || compression === 0)) {
    fs.writeFileSync(finalPath, rawBuf);
    return { ok: true, filePath: finalPath, fileName };
  }

  const tmpPng = path.join(app.getPath('temp'), `morshynska_shot_${Date.now()}.png`);
  fs.writeFileSync(tmpPng, rawBuf);

  if (isWebp) {
    const q = optimize ? Math.max(35, Math.round(95 - (compression / 100) * 60)) : 95;
    await runFfmpeg(['-y', '-i', tmpPng, '-c:v', 'libwebp', '-quality', String(q), finalPath]);
  } else {
    const colors = Math.max(64, Math.round(256 - (compression / 100) * 160));
    await runFfmpeg([
      '-y',
      '-i', tmpPng,
      '-vf', `split[s0][s1];[s0]palettegen=max_colors=${colors}[p];[s1][p]paletteuse`,
      finalPath
    ]);
  }

  try { fs.unlinkSync(tmpPng); } catch (e) {}
  return { ok: fs.existsSync(finalPath), filePath: finalPath, fileName };
});

ipcMain.handle('trigger-copy-overlay', async () => {
  await launchCopyOverlay();
  return true;
});

const LAST_CLIP_PNG_PATH = path.join(USER_DATA_DIR, 'last_copied_region.png');
let lastCopiedNativeImg = null;

function createNativeImgFromPayload(payload) {
  if (!payload) return null;
  try {
    if (payload.dataUrl && typeof payload.dataUrl === 'string') {
      const b64 = payload.dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const buf = Buffer.from(b64, 'base64');
      try {
        fs.mkdirSync(USER_DATA_DIR, { recursive: true });
        fs.writeFileSync(LAST_CLIP_PNG_PATH, buf);
      } catch (e) {}
      let img = nativeImage.createFromPath(LAST_CLIP_PNG_PATH);
      if (!img || img.isEmpty()) {
        img = nativeImage.createFromBuffer(buf);
      }
      if (!img || img.isEmpty()) {
        img = nativeImage.createFromDataURL(payload.dataUrl);
      }
      if (img && !img.isEmpty()) return img;
    }
    if (payload.bgra && payload.width && payload.height) {
      let buf;
      if (Buffer.isBuffer(payload.bgra)) {
        buf = payload.bgra;
      } else if (payload.bgra.byteLength !== undefined && payload.bgra.buffer) {
        buf = Buffer.from(payload.bgra.buffer, payload.bgra.byteOffset || 0, payload.bgra.byteLength);
      } else {
        buf = Buffer.from(payload.bgra);
      }
      const img = nativeImage.createFromBitmap(buf, {
        width: Math.round(payload.width),
        height: Math.round(payload.height)
      });
      if (!img.isEmpty()) return img;
    }
  } catch (err) {
    console.error('createNativeImgFromPayload error:', err);
  }
  return null;
}

function writeNativeImgWithVerify(img) {
  if (!img || img.isEmpty()) return false;
  lastCopiedNativeImg = img;
  const targetSize = img.getSize();
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      clipboard.writeImage(img);
      const verify = clipboard.readImage();
      const vSize = verify.getSize();
      if (!verify.isEmpty() && vSize.width === targetSize.width && vSize.height === targetSize.height) {
        return true;
      }
    } catch (e) {}
  }
  // Fallback via PowerShell System.Windows.Forms.Clipboard::SetImage if Electron clipboard was locked
  try {
    if (fs.existsSync(LAST_CLIP_PNG_PATH)) {
      spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-WindowStyle', 'Hidden',
        '-STA',
        '-Command',
        `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $i = [System.Drawing.Image]::FromFile('${LAST_CLIP_PNG_PATH.replace(/'/g, "''")}'); [System.Windows.Forms.Clipboard]::SetImage($i); $i.Dispose()`
      ], { windowsHide: true });
      return true;
    }
  } catch (e) {}
  return false;
}

function writePngPayloadToClipboard(payload) {
  try {
    const img = createNativeImgFromPayload(payload);
    if (img && writeNativeImgWithVerify(img)) {
      setTimeout(() => { if (lastCopiedNativeImg) writeNativeImgWithVerify(lastCopiedNativeImg); }, 80);
      setTimeout(() => { if (lastCopiedNativeImg) writeNativeImgWithVerify(lastCopiedNativeImg); }, 220);
      return true;
    }
  } catch (err) {
    console.error('Clipboard write error:', err);
  }
  return false;
}

ipcMain.on('write-clipboard-png', (_e, payload) => {
  writePngPayloadToClipboard(payload);
});

ipcMain.handle('copy-overlay-finish', (_e, payload) => {
  writePngPayloadToClipboard(payload);
  if (copyOverlayWindow && !copyOverlayWindow.isDestroyed()) {
    copyOverlayWindow.hide();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('copy-completed', {
      ok: true,
      width: payload && payload.width,
      height: payload && payload.height
    });
  }
  return true;
});

ipcMain.handle('copy-overlay-save-as', async (_e, payload) => {
  try {
    const img = createNativeImgFromPayload(payload);
    if (img) writeNativeImgWithVerify(img);
    if (copyOverlayWindow && !copyOverlayWindow.isDestroyed()) {
      copyOverlayWindow.hide();
    }
    const stamp = getTimestampStamp();
    const defaultDir = appConfig.shotDir || app.getPath('pictures');
    fs.mkdirSync(defaultDir, { recursive: true });
    const defaultPath = path.join(defaultDir, `Shot_${stamp}.png`);

    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Сохранить скриншот в папку',
      defaultPath,
      filters: [
        { name: 'PNG Изображение', extensions: ['png'] },
        { name: 'JPEG Изображение', extensions: ['jpg', 'jpeg'] },
        { name: 'WebP Изображение', extensions: ['webp'] }
      ]
    });

    if (!res.canceled && res.filePath && img) {
      const ext = path.extname(res.filePath).toLowerCase();
      const outBuf = (ext === '.jpg' || ext === '.jpeg') ? img.toJPEG(95) : img.toPNG();
      fs.writeFileSync(res.filePath, outBuf);
      // Remember chosen directory for convenience
      appConfig = saveConfig({ shotDir: path.dirname(res.filePath) });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('copy-completed', {
          ok: true,
          savedFile: true,
          width: payload && payload.width,
          height: payload && payload.height
        });
      }
      return { ok: true, filePath: res.filePath };
    }
  } catch (err) {
    console.error('copy-overlay-save-as error:', err);
  }
  return { ok: false };
});

ipcMain.handle('copy-overlay-cancel', (_e, payload) => {
  const hadSel = !!(payload && payload.hadSelection);
  if (hadSel && payload) {
    writePngPayloadToClipboard(payload);
  }
  if (copyOverlayWindow && !copyOverlayWindow.isDestroyed()) {
    copyOverlayWindow.hide();
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('copy-completed', {
      ok: hadSel,
      width: payload && payload.width,
      height: payload && payload.height
    });
  }
  return true;
});

ipcMain.on('update-hud-state', (_e, data) => {
  if (hudWindow && !hudWindow.isDestroyed()) {
    hudWindow.webContents.send('hud-update', data);
  }
});

// Window Controls: 'close' (X button) ALWAYS hides to tray! Only Tray right-click -> "Выход" quits!
ipcMain.on('window-control', (_e, cmd) => {
  if (!mainWindow) return;
  if (cmd === 'minimize') {
    mainWindow.minimize();
  } else if (cmd === 'tray' || cmd === 'close') {
    mainWindow.hide();
  }
});

let latestUpdateAssetUrl = null;

ipcMain.handle('check-for-updates', async () => {
  const currentVersion = app.getVersion();
  const repo = appConfig.githubRepo || 'mmorgame/morshynska-lab-capture';
  const token = appConfig.githubToken || process.env.MORSHYNSKA_GH_TOKEN || '';

  return new Promise((resolve) => {
    const headers = {
      'User-Agent': 'Morshynska-Lab-Capture-Updater',
      'Accept': 'application/vnd.github+json'
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = https.get(
      `https://api.github.com/repos/${repo}/releases/latest`,
      { headers },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              return resolve({ currentVersion, updateAvailable: false });
            }
            const rel = JSON.parse(body);
            const latestTag = (rel.tag_name || '').replace(/^v/, '');
            const isNewer = latestTag && latestTag !== currentVersion;
            const setupAsset = (rel.assets || []).find(a => a.name.endsWith('.exe'));
            if (isNewer && setupAsset) {
              latestUpdateAssetUrl = setupAsset.url;
            }
            resolve({
              currentVersion,
              latestVersion: latestTag || currentVersion,
              updateAvailable: !!isNewer,
              notes: rel.name || rel.body || ''
            });
          } catch (e) {
            resolve({ currentVersion, updateAvailable: false });
          }
        });
      }
    );
    req.on('error', () => resolve({ currentVersion, updateAvailable: false }));
    req.end();
  });
});

ipcMain.handle('install-update', async () => {
  if (!latestUpdateAssetUrl) return { ok: false };
  const repo = appConfig.githubRepo || 'mmorgame/morshynska-lab-capture';
  await shell.openExternal(`https://github.com/${repo}/releases/latest`);
  return { ok: true };
});

app.whenReady().then(() => {
  ensureDirs();
  createMainWindow();
  createHudWindow();
  createCopyOverlayWindow();
  createSystemTray();
  registerAllHotkeys();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
