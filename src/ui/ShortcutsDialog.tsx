import { useEffect } from "react";
import { Icon } from "./icons";
import { Kbd } from "./components";

const GROUPS: Array<{ title: string; items: Array<{ keys: string[]; label: string }> }> = [
  {
    title: "مساحة العمل",
    items: [
      { keys: ["V"], label: "أداة التحديد" },
      { keys: ["H"], label: "أداة التحريك" },
      { keys: ["Space"], label: "تحريك مؤقت أثناء السحب" },
      { keys: ["+", "−"], label: "تكبير / تصغير" },
      { keys: ["0"], label: "احتواء الرسم" },
      { keys: ["Alt"], label: "تعطيل الالتقاط مؤقتاً" },
      { keys: ["Shift"], label: "تقييد الحركة على محور واحد" },
    ],
  },
  {
    title: "التحرير والتنقل",
    items: [
      { keys: ["Ctrl", "Z"], label: "تراجع" },
      { keys: ["Ctrl", "Shift", "Z"], label: "إعادة" },
      { keys: ["Ctrl", "Y"], label: "إعادة (بديل)" },
      { keys: ["Esc"], label: "إغلاق النافذة الحالية" },
      { keys: ["?"], label: "عرض قائمة الاختصارات" },
    ],
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ShortcutsDialog({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div
        className="modal-card shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <span className="modal-icon"><Icon name="keyboard" size={20} /></span>
          <div>
            <h2 id="shortcuts-title">اختصارات لوحة المفاتيح</h2>
            <p className="hint">اختصارات مساحة العمل والمحرر.</p>
          </div>
          <button className="icon-btn has-tip" data-tip="إغلاق" aria-label="إغلاق" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="shortcuts-grid">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3>{group.title}</h3>
              <ul>
                {group.items.map((item) => (
                  <li key={item.label}>
                    <span>{item.label}</span>
                    <span className="shortcut-keys">
                      {item.keys.map((key) => <Kbd key={key}>{key}</Kbd>)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
