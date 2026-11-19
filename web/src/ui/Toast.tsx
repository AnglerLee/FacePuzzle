// 화면 아래 잠깐 뜨는 안내. 되돌리기 같은 버튼을 하나 달 수 있다.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  tone: "info" | "error" | "success";
  action?: ToastAction;
}

type ShowToast = (message: string, opts?: { tone?: ToastItem["tone"]; action?: ToastAction }) => void;

const ToastContext = createContext<ShowToast>(() => undefined);

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const show = useCallback<ShowToast>((message, opts = {}) => {
    const id = nextId.current++;
    const item: ToastItem = { id, message, tone: opts.tone ?? "info", action: opts.action };
    setItems((list) => [...list.slice(-1), item]);
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), opts.action ? 5500 : 3200);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <span>{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  t.action?.onClick();
                  setItems((list) => list.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
