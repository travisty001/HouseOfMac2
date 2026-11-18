export const shots = {
  front: { label: 'Front', direction: [0, 0, 1] },
  back: { label: 'Rear', direction: [0, 0, -1] },
  left: { label: 'Left profile', direction: [-1, 0, 0] },
  right: { label: 'Right profile', direction: [1, 0, 0] },
  top: { label: 'Dorsal', direction: [0, 1, 0], up: [0, 0, -1] },
  bottom: { label: 'Ventral', direction: [0, -1, 0], up: [0, 0, 1] },
  'dorsal-30-front': { label: 'Dorsal 30° front', direction: [0, Math.sqrt(3), 1] },
  'dorsal-30-rear': { label: 'Dorsal 30° rear', direction: [0, Math.sqrt(3), -1] },
};

export function integrateRotation(speed, target, seconds, response = 10) {
  const blend = -Math.expm1(-response * seconds);
  return {
    speed: speed + (target - speed) * blend,
    travel: target * seconds + (speed - target) * blend / response,
  };
}

export function download(href, filename) {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}

export function downloadBlob(blob, filename) {
  const href = URL.createObjectURL(blob);
  download(href, filename);
  setTimeout(() => URL.revokeObjectURL(href), 10000);
}

function openBench() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('house-of-mac-bench', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('scans', { keyPath: 'id' });
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

async function benchRequest(mode, operation) {
  const db = await openBench();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('scans', mode);
      const req = operation(tx.objectStore('scans'));
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = () => reject(tx.error || new Error('Scan storage was interrupted.'));
    });
  } finally {
    db.close();
  }
}

export const listScans = () => benchRequest('readonly', store => store.getAll());
export const saveScan = scan => benchRequest('readwrite', store => store.put(scan));
