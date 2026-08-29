import './style.css';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, rgb } from 'pdf-lib';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const MM_TO_PT = 72 / 25.4;
const MAX_PREVIEW_PX_PER_MM = 2.2;
const PAPERS = {
  a4: [210, 297],
  a3: [297, 420],
  letter: [215.9, 279.4],
};

const $ = (id) => document.getElementById(id);
const ui = {
  input: $('file-input'), drop: $('drop-zone'), fileLabel: $('file-label'), paper: $('paper-size'),
  orientation: $('orientation'), margin: $('margin'), overlap: $('overlap'), scale: $('scale'),
  cropTop: $('crop-top'), cropRight: $('crop-right'), cropBottom: $('crop-bottom'), cropLeft: $('crop-left'),
  offsetX: $('offset-x'), offsetY: $('offset-y'), board: $('board'),
  frame: $('board-frame'), sheetOverlay: $('sheet-overlay'), cropBox: $('crop-box'), magnifier: $('crop-magnifier'),
  canvas: $('preview'), viewport: $('viewport'), empty: $('empty-state'), summary: $('summary'),
  export: $('export'), center: $('center'), marginOut: $('margin-out'), overlapOut: $('overlap-out'),
  scaleOut: $('scale-out'),
};

let sourceBytes = null;
let sourceName = '';
let sourceSizePt = null;
let dragging = null;
let cropDragging = null;
let previewPxPerMm = MAX_PREVIEW_PX_PER_MM;

function updateMagnifier(event, edge) {
  const size = ui.magnifier.width;
  const zoom = 3;
  const canvasRect = ui.canvas.getBoundingClientRect();
  const sourceX = (event.clientX - canvasRect.left) / canvasRect.width * ui.canvas.width;
  const sourceY = (event.clientY - canvasRect.top) / canvasRect.height * ui.canvas.height;
  const sourcePerCssX = ui.canvas.width / canvasRect.width;
  const sourcePerCssY = ui.canvas.height / canvasRect.height;
  const sampleW = size / zoom * sourcePerCssX;
  const sampleH = size / zoom * sourcePerCssY;
  const context = ui.magnifier.getContext('2d');
  context.clearRect(0, 0, size, size);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, size, size);
  context.drawImage(ui.canvas, sourceX - sampleW / 2, sourceY - sampleH / 2, sampleW, sampleH, 0, 0, size, size);
  context.strokeStyle = '#0d8f68';
  context.lineWidth = 3;
  context.beginPath();
  if (edge === 'left' || edge === 'right') {
    context.moveTo(size / 2, 0);
    context.lineTo(size / 2, size);
  } else {
    context.moveTo(0, size / 2);
    context.lineTo(size, size / 2);
  }
  context.stroke();
  const offset = 22;
  const magnifierSize = 160;
  let left = event.clientX + offset;
  let top = event.clientY - magnifierSize - offset;
  if (left + magnifierSize > window.innerWidth - 8) left = event.clientX - magnifierSize - offset;
  if (top < 8) top = event.clientY + offset;
  ui.magnifier.style.left = `${left}px`;
  ui.magnifier.style.top = `${top}px`;
  ui.magnifier.classList.add('visible');
}

function paperMm(orientation = ui.orientation.value) {
  let [w, h] = PAPERS[ui.paper.value];
  return orientation === 'landscape' ? [h, w] : [w, h];
}

function settings() {
  const margin = Number(ui.margin.value);
  const overlap = Number(ui.overlap.value);
  const scale = Number(ui.scale.value) / 100;
  const sourceW = sourceSizePt ? sourceSizePt.width / MM_TO_PT : 0;
  const sourceH = sourceSizePt ? sourceSizePt.height / MM_TO_PT : 0;
  const cropLeft = Math.min(Math.max(0, Number(ui.cropLeft.value) || 0), Math.max(0, sourceW - .1));
  const cropRight = Math.min(Math.max(0, Number(ui.cropRight.value) || 0), Math.max(0, sourceW - cropLeft - .1));
  const cropTop = Math.min(Math.max(0, Number(ui.cropTop.value) || 0), Math.max(0, sourceH - .1));
  const cropBottom = Math.min(Math.max(0, Number(ui.cropBottom.value) || 0), Math.max(0, sourceH - cropTop - .1));
  const fullDocW = sourceW * scale;
  const fullDocH = sourceH * scale;
  const docW = (sourceW - cropLeft - cropRight) * scale;
  const docH = (sourceH - cropTop - cropBottom) * scale;
  const x = Number(ui.offsetX.value) || 0;
  const y = Number(ui.offsetY.value) || 0;
  const contentX = x + cropLeft * scale;
  const contentY = y + cropTop * scale;
  const layoutFor = (orientation) => {
    const [paperW, paperH] = paperMm(orientation);
    const printableW = paperW - 2 * margin;
    const printableH = paperH - 2 * margin;
    const stepW = printableW - overlap;
    const stepH = printableH - overlap;
    const cols = sourceSizePt ? Math.max(1, Math.ceil((contentX + docW - overlap) / stepW)) : 1;
    const rows = sourceSizePt ? Math.max(1, Math.ceil((contentY + docH - overlap) / stepH)) : 1;
    return { orientation, paperW, paperH, printableW, printableH, stepW, stepH, cols, rows };
  };
  let layout = layoutFor(ui.orientation.value === 'landscape' ? 'landscape' : 'portrait');
  if (ui.orientation.value === 'auto') {
    const landscape = layoutFor('landscape');
    if (landscape.cols * landscape.rows < layout.cols * layout.rows) layout = landscape;
  }
  return { ...layout, margin, overlap, scale, sourceW, sourceH, fullDocW, fullDocH, docW, docH, cropTop, cropRight, cropBottom, cropLeft, x, y, contentX, contentY };
}

function update() {
  ui.marginOut.value = `${ui.margin.value} mm`;
  ui.overlapOut.value = `${ui.overlap.value} mm`;
  ui.scaleOut.value = `${ui.scale.value} %`;
  if (!sourceSizePt) return;
  const s = settings();
  const displayLayout = cropDragging?.layout ?? s;
  const displayCols = cropDragging?.cols ?? s.cols;
  const displayRows = cropDragging?.rows ?? s.rows;
  const boardW = cropDragging?.boardW ?? Math.max(s.contentX + s.docW, displayCols * s.stepW + s.overlap);
  const boardH = cropDragging?.boardH ?? Math.max(s.contentY + s.docH, displayRows * s.stepH + s.overlap);
  const viewportStyle = getComputedStyle(ui.viewport);
  const availableW = ui.viewport.clientWidth - parseFloat(viewportStyle.paddingLeft) - parseFloat(viewportStyle.paddingRight);
  const availableH = ui.viewport.clientHeight - parseFloat(viewportStyle.paddingTop) - parseFloat(viewportStyle.paddingBottom);
  previewPxPerMm = cropDragging?.previewPxPerMm ?? Math.max(.1, Math.min(MAX_PREVIEW_PX_PER_MM, availableW / boardW, availableH / boardH));
  const previewW = boardW * previewPxPerMm;
  const previewH = boardH * previewPxPerMm;
  ui.frame.style.width = `${previewW}px`;
  ui.frame.style.height = `${previewH}px`;
  ui.board.style.width = `${previewW}px`;
  ui.board.style.height = `${previewH}px`;
  ui.canvas.style.width = `${s.fullDocW * previewPxPerMm}px`;
  ui.canvas.style.height = `${s.fullDocH * previewPxPerMm}px`;
  ui.canvas.style.left = `${s.x * previewPxPerMm}px`;
  ui.canvas.style.top = `${s.y * previewPxPerMm}px`;
  ui.canvas.style.clipPath = `inset(${s.cropTop / s.sourceH * 100}% ${s.cropRight / s.sourceW * 100}% ${s.cropBottom / s.sourceH * 100}% ${s.cropLeft / s.sourceW * 100}%)`;
  ui.cropBox.style.left = `${s.contentX * previewPxPerMm}px`;
  ui.cropBox.style.top = `${s.contentY * previewPxPerMm}px`;
  ui.cropBox.style.width = `${s.docW * previewPxPerMm}px`;
  ui.cropBox.style.height = `${s.docH * previewPxPerMm}px`;
  ui.sheetOverlay.replaceChildren();
  for (let row = 0; row < displayRows; row++) {
    for (let col = 0; col < displayCols; col++) {
      const sheet = document.createElement('div');
      sheet.className = 'sheet';
      sheet.style.left = `${col * displayLayout.stepW * previewPxPerMm}px`;
      sheet.style.top = `${row * displayLayout.stepH * previewPxPerMm}px`;
      sheet.style.width = `${displayLayout.printableW * previewPxPerMm}px`;
      sheet.style.height = `${displayLayout.printableH * previewPxPerMm}px`;
      ui.sheetOverlay.append(sheet);
    }
  }
  const orientationLabel = displayLayout.orientation === 'landscape' ? 'Querformat' : 'Hochformat';
  ui.summary.innerHTML = `<strong>${displayCols} × ${displayRows} = ${displayCols * displayRows} Blätter</strong><br>${s.docW.toFixed(1)} × ${s.docH.toFixed(1)} mm Dokumentgröße<br>${orientationLabel}`;
}

async function loadFile(file) {
  if (!file || (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'))) return alert('Bitte eine PDF-Datei auswählen.');
  try {
    sourceBytes = new Uint8Array(await file.arrayBuffer());
    sourceName = file.name.replace(/\.pdf$/i, '');
    const pdf = await pdfjsLib.getDocument({ data: sourceBytes.slice() }).promise;
    const page = await pdf.getPage(1);
    const unitViewport = page.getViewport({ scale: 1 });
    sourceSizePt = { width: unitViewport.width, height: unitViewport.height };
    const renderScale = 2;
    const viewport = page.getViewport({ scale: renderScale });
    ui.canvas.width = Math.ceil(viewport.width);
    ui.canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: ui.canvas.getContext('2d'), viewport }).promise;
  } catch (error) {
    console.error(error);
    alert(`PDF konnte nicht geladen werden: ${error.message}`);
    return;
  }
  ui.fileLabel.textContent = file.name;
  ui.empty.classList.add('hidden');
  ui.frame.classList.remove('hidden');
  ui.export.disabled = false;
  ui.center.disabled = false;
  ui.cropTop.value = 0;
  ui.cropRight.value = 0;
  ui.cropBottom.value = 0;
  ui.cropLeft.value = 0;
  ui.offsetX.value = 0;
  ui.offsetY.value = 0;
  update();
}

function centerDocument() {
  const s = settings();
  ui.offsetX.value = ((s.cols * s.stepW + s.overlap - s.docW) / 2 - s.cropLeft * s.scale).toFixed(1);
  ui.offsetY.value = ((s.rows * s.stepH + s.overlap - s.docH) / 2 - s.cropTop * s.scale).toFixed(1);
  update();
}

ui.canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  const s = settings();
  dragging = { pointerX: event.clientX, pointerY: event.clientY, x: s.x, y: s.y };
  ui.canvas.setPointerCapture(event.pointerId);
  ui.canvas.classList.add('dragging');
});
ui.canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  if (!(event.buttons & 1)) {
    stopDocumentDragging();
    return;
  }
  ui.offsetX.value = (dragging.x + (event.clientX - dragging.pointerX) / previewPxPerMm).toFixed(1);
  ui.offsetY.value = (dragging.y + (event.clientY - dragging.pointerY) / previewPxPerMm).toFixed(1);
  update();
});
function stopDocumentDragging() {
  dragging = null;
  ui.canvas.classList.remove('dragging');
}
ui.canvas.addEventListener('pointerup', stopDocumentDragging);
ui.canvas.addEventListener('pointercancel', stopDocumentDragging);
ui.canvas.addEventListener('lostpointercapture', stopDocumentDragging);
ui.canvas.addEventListener('dragstart', (event) => event.preventDefault());

ui.cropBox.querySelectorAll('.crop-handle').forEach((handle) => {
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const s = settings();
    cropDragging = {
      edge: handle.dataset.edge, pointerX: event.clientX, pointerY: event.clientY,
      top: s.cropTop, right: s.cropRight, bottom: s.cropBottom, left: s.cropLeft,
      sourceW: s.sourceW, sourceH: s.sourceH, scale: s.scale,
      cols: s.cols, rows: s.rows,
      boardW: Math.max(s.contentX + s.docW, s.cols * s.stepW + s.overlap),
      boardH: Math.max(s.contentY + s.docH, s.rows * s.stepH + s.overlap),
      previewPxPerMm,
      layout: { orientation: s.orientation, stepW: s.stepW, stepH: s.stepH, printableW: s.printableW, printableH: s.printableH },
    };
    handle.setPointerCapture(event.pointerId);
    ui.cropBox.classList.add('cropping');
    updateMagnifier(event, handle.dataset.edge);
  });
  handle.addEventListener('pointermove', (event) => {
    if (!cropDragging || cropDragging.edge !== handle.dataset.edge) return;
    const dx = (event.clientX - cropDragging.pointerX) / previewPxPerMm / cropDragging.scale;
    const dy = (event.clientY - cropDragging.pointerY) / previewPxPerMm / cropDragging.scale;
    if (cropDragging.edge === 'left') ui.cropLeft.value = Math.min(cropDragging.sourceW - cropDragging.right - .1, Math.max(0, cropDragging.left + dx)).toFixed(1);
    if (cropDragging.edge === 'right') ui.cropRight.value = Math.min(cropDragging.sourceW - cropDragging.left - .1, Math.max(0, cropDragging.right - dx)).toFixed(1);
    if (cropDragging.edge === 'top') ui.cropTop.value = Math.min(cropDragging.sourceH - cropDragging.bottom - .1, Math.max(0, cropDragging.top + dy)).toFixed(1);
    if (cropDragging.edge === 'bottom') ui.cropBottom.value = Math.min(cropDragging.sourceH - cropDragging.top - .1, Math.max(0, cropDragging.bottom - dy)).toFixed(1);
    update();
    updateMagnifier(event, cropDragging.edge);
  });
  const stopCropping = () => {
    cropDragging = null;
    ui.cropBox.classList.remove('cropping');
    ui.magnifier.classList.remove('visible');
    update();
  };
  handle.addEventListener('pointerup', stopCropping);
  handle.addEventListener('pointercancel', stopCropping);
});

async function exportPdf() {
  const s = settings();
  ui.export.disabled = true;
  ui.export.textContent = 'PDF wird erstellt …';
  try {
    const source = await PDFDocument.load(sourceBytes.slice());
    const output = await PDFDocument.create();
    const pt = (mm) => mm * MM_TO_PT;
    const sourcePage = source.getPage(0);
    const embedded = await output.embedPage(sourcePage, {
      left: pt(s.cropLeft),
      bottom: pt(s.cropBottom),
      right: sourcePage.getWidth() - pt(s.cropRight),
      top: sourcePage.getHeight() - pt(s.cropTop),
    });
    for (let row = 0; row < s.rows; row++) {
      for (let col = 0; col < s.cols; col++) {
        const page = output.addPage([pt(s.paperW), pt(s.paperH)]);
        const relX = s.contentX - col * s.stepW;
        const relY = s.contentY - row * s.stepH;
        page.drawPage(embedded, {
          x: pt(s.margin + relX),
          y: pt(s.paperH - s.margin - relY - s.docH),
          width: pt(s.docW),
          height: pt(s.docH),
        });
        // White masks keep content out of the printer margins.
        const white = rgb(1, 1, 1);
        page.drawRectangle({ x: 0, y: 0, width: pt(s.paperW), height: pt(s.margin), color: white });
        page.drawRectangle({ x: 0, y: pt(s.paperH - s.margin), width: pt(s.paperW), height: pt(s.margin), color: white });
        page.drawRectangle({ x: 0, y: 0, width: pt(s.margin), height: pt(s.paperH), color: white });
        page.drawRectangle({ x: pt(s.paperW - s.margin), y: 0, width: pt(s.margin), height: pt(s.paperH), color: white });
        if (s.margin >= 3) drawCutMarks(page, s, pt, row, col);
      }
    }
    const bytes = await output.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${sourceName}-gekachelt.pdf`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (error) {
    console.error(error);
    alert(`Export fehlgeschlagen: ${error.message}`);
  } finally {
    ui.export.disabled = false;
    ui.export.textContent = 'Gekachelte PDF exportieren';
  }
}

function drawCutMarks(page, s, pt, row, col) {
  const color = rgb(.2, .25, .23);
  const length = Math.min(5, s.margin - 1);
  const opts = { thickness: .45, color };
  const selectedCorner = document.querySelector('input[name="cut-corner"]:checked')?.value || 'top-left';
  const sides = {
    top: selectedCorner.startsWith('top'),
    right: selectedCorner.endsWith('right'),
    bottom: selectedCorner.startsWith('bottom'),
    left: selectedCorner.endsWith('left'),
  };
  // Finish the outside edge on the final sheet in the chosen assembly direction.
  if (sides.top && row === s.rows - 1) sides.bottom = true;
  if (sides.left && col === s.cols - 1) sides.right = true;
  if (sides.bottom && row === 0) sides.top = true;
  if (sides.right && col === 0) sides.left = true;
  const xs = [];
  if (sides.left) xs.push(s.margin);
  if (sides.right) xs.push(s.paperW - s.margin);
  const ys = [];
  if (sides.bottom) ys.push(s.margin);
  if (sides.top) ys.push(s.paperH - s.margin);
  xs.forEach((x) => {
    page.drawLine({ start: { x: pt(x), y: pt(1) }, end: { x: pt(x), y: pt(1 + length) }, ...opts });
    page.drawLine({ start: { x: pt(x), y: pt(s.paperH - 1) }, end: { x: pt(x), y: pt(s.paperH - 1 - length) }, ...opts });
  });
  ys.forEach((y) => {
    page.drawLine({ start: { x: pt(1), y: pt(y) }, end: { x: pt(1 + length), y: pt(y) }, ...opts });
    page.drawLine({ start: { x: pt(s.paperW - 1), y: pt(y) }, end: { x: pt(s.paperW - 1 - length), y: pt(y) }, ...opts });
  });
}

ui.input.addEventListener('change', () => loadFile(ui.input.files[0]));
['dragenter', 'dragover'].forEach((name) => ui.drop.addEventListener(name, (e) => { e.preventDefault(); ui.drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach((name) => ui.drop.addEventListener(name, (e) => { e.preventDefault(); ui.drop.classList.remove('drag'); }));
ui.drop.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
[ui.paper, ui.orientation, ui.margin, ui.overlap, ui.scale, ui.cropTop, ui.cropRight, ui.cropBottom, ui.cropLeft, ui.offsetX, ui.offsetY].forEach((el) => el.addEventListener('input', update));
ui.center.addEventListener('click', centerDocument);
ui.export.addEventListener('click', exportPdf);
window.addEventListener('resize', update);
update();
