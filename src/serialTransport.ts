type RpcTransport = {
  label: string;
  abortController: AbortController;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
};

type SerialPortLike = {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
};

type SerialNavigator = Navigator & {
  serial: {
    requestPort(options?: Record<string, never>): Promise<SerialPortLike>;
  };
};

export type ClosableRpcTransport = RpcTransport & {
  close: () => Promise<void>;
};

export async function connectSerial(): Promise<ClosableRpcTransport> {
  const abortController = new AbortController();
  const port = await (navigator as SerialNavigator).serial.requestPort({});

  try {
    await port.open({ baudRate: 12500 });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NetworkError') {
      throw new Error(
        'Failed to open the serial port. Check permissions and verify it is not in use by another app.',
        { cause: error },
      );
    }
    throw error;
  }

  const info = port.getInfo();
  const label = `${info.usbVendorId?.toLocaleString() || ''}:${info.usbProductId?.toLocaleString() || ''}`;

  let closePromise: Promise<void> | null = null;

  const close = () => {
    if (closePromise) return closePromise;

    closePromise = (async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const readableLocked = port.readable?.locked ?? false;
        const writableLocked = port.writable?.locked ?? false;
        if (!readableLocked && !writableLocked) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      try {
        if (port.readable && !port.readable.locked) {
          await port.readable.cancel();
        }
      } catch (error) {
        console.debug('[MyZMKStudio] serial readable cancel ignored', error);
      }

      try {
        if (port.writable && !port.writable.locked) {
          await port.writable.close();
        }
      } catch (error) {
        console.debug('[MyZMKStudio] serial writable close ignored', error);
      }

      try {
        await port.close();
      } catch (error) {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          if (!(port.readable?.locked ?? false) && !(port.writable?.locked ?? false)) {
            try {
              await port.close();
              return;
            } catch {
              // Continue retrying below.
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw error;
      }
    })();

    return closePromise;
  };

  abortController.signal.addEventListener(
    'abort',
    () => {
      void close().catch((error) => {
        console.warn('[MyZMKStudio] serial close after abort failed', error);
      });
    },
    { once: true },
  );

  if (!port.readable || !port.writable) {
    throw new Error('Serial port opened without readable/writable streams.');
  }

  return {
    label,
    abortController,
    readable: port.readable,
    writable: port.writable,
    close,
  };
}
