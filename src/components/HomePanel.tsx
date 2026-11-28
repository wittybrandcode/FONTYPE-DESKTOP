import { useMemo, useState } from "react";
import {
  filterRecents,
  pathKey,
  relativeTime,
  type HomePrefs,
  type RecentProject,
  type RecentScope,
} from "../core/recentProjects";
import { Icon } from "../ui/icons";
import { IconButton, SegmentedControl, StatusChip } from "../ui/components";

interface Props {
  recents: RecentProject[];
  activePath: string | null;
  prefs: HomePrefs;
  onPrefs: (prefs: HomePrefs) => void;
  onNew: () => void;
  onBrowse: () => void;
  onOpen: (path: string) => void;
  onTogglePin: (path: string) => void;
  onRemove: (path: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}

const SCOPES: Array<{ value: RecentScope; label: string }> = [
  { value: "all", label: "الكل" },
  { value: "pinned", label: "المثبّتة" },
  { value: "ready", label: "معتمدة" },
  { value: "review", label: "للمراجعة" },
];

function cardStatus(item: RecentProject): { tone: "danger" | "warning" | "accent" | "neutral"; label: string } {
  if (!item.available) return { tone: "danger", label: "غير متاح" };
  if (item.review > 0) return { tone: "warning", label: "للمراجعة" };
  if (item.ready > 0) return { tone: "accent", label: "معتمدة" };
  return { tone: "neutral", label: "مسودة" };
}

export default function HomePanel({
  recents,
  activePath,
  prefs,
  onPrefs,
  onNew,
  onBrowse,
  onOpen,
  onTogglePin,
  onRemove,
  onRefresh,
  refreshing,
}: Props) {
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () => filterRecents(recents, query, prefs.scope, prefs.sort),
    [recents, query, prefs.scope, prefs.sort],
  );
  const available = recents.filter((item) => item.available);
  const readyCount = available.filter((item) => item.ready > 0).length;
  const reviewCount = available.filter((item) => item.review > 0).length;
  const pinnedCount = available.filter((item) => item.pinned).length;
  const currentKey = activePath ? pathKey(activePath) : null;

  return (
    <section className="home-view" aria-labelledby="home-title">
      <header className="home-hero panel">
        <div className="home-hero-copy">
          <span className="home-eyebrow"><Icon name="home" size={13} /> مساحة البداية</span>
          <h1 id="home-title">مشاريعك، جاهزة للإكمال</h1>
          <p className="home-hero-sub">
            تابع آخر مشاريع الخطوط العربية وافتحها مباشرة. كل شيء محفوظ محلياً على هذا الجهاز.
          </p>
          <div className="home-hero-actions">
            <button type="button" className="ui-button ui-button--primary" onClick={onNew}>
              <Icon name="plus" size={14} /> مشروع جديد
            </button>
            <button type="button" className="ui-button" onClick={onBrowse}>
              <Icon name="folderOpen" size={14} /> فتح مشروع موجود
            </button>
          </div>
        </div>
        <div className="home-hero-mark" aria-hidden="true">
          <span>أ</span>
        </div>
        <dl className="home-stats">
          <div><dt>المشاريع</dt><dd>{available.length}</dd></div>
          <div><dt>معتمدة</dt><dd>{readyCount}</dd></div>
          <div><dt>للمراجعة</dt><dd>{reviewCount}</dd></div>
          <div><dt>مثبّتة</dt><dd>{pinnedCount}</dd></div>
        </dl>
      </header>

      <section className="home-library" aria-labelledby="home-recent-title">
        <div className="home-library-head">
          <div className="home-library-title">
            <h2 id="home-recent-title">المشاريع الأخيرة</h2>
            <span className="home-count">{visible.length} من {recents.length}</span>
          </div>
          <div className="home-library-tools">
            <label className="home-search">
              <Icon name="search" size={13} aria-hidden="true" />
              <span className="sr-only">ابحث في المشاريع</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ابحث بالاسم أو العائلة أو المسار"
              />
            </label>
            <label className="home-sort">
              <span className="sr-only">ترتيب المشاريع</span>
              <select
                value={prefs.sort}
                onChange={(event) => onPrefs({ ...prefs, sort: event.target.value as HomePrefs["sort"] })}
              >
                <option value="opened">آخر استخدام</option>
                <option value="modified">آخر تعديل</option>
                <option value="name">الاسم</option>
              </select>
            </label>
            <SegmentedControl
              label="طريقة عرض المشاريع"
              value={prefs.view}
              options={[
                { value: "grid", label: "شبكة", icon: "squares" },
                { value: "list", label: "قائمة", icon: "listChecks" },
              ]}
              onChange={(view) => onPrefs({ ...prefs, view })}
            />
            <IconButton
              icon="sync"
              label="تحديث السجل من القرص"
              size={14}
              disabled={refreshing}
              onClick={onRefresh}
            />
          </div>
        </div>

        <div className="home-scopes" role="group" aria-label="تصفية المشاريع">
          {SCOPES.map((scope) => (
            <button
              key={scope.value}
              type="button"
              className="home-scope"
              aria-pressed={prefs.scope === scope.value}
              onClick={() => onPrefs({ ...prefs, scope: scope.value })}
            >
              {scope.label}
            </button>
          ))}
        </div>

        {recents.length === 0 ? (
          <div className="home-empty panel">
            <span className="home-empty-icon"><Icon name="folderOpen" size={26} /></span>
            <h3>لا توجد مشاريع في السجل بعد</h3>
            <p>أنشئ مشروعاً جديداً، أو افتح مجلد مشروع بصيغة .afsp ليظهر هنا.</p>
            <div className="home-empty-actions">
              <button type="button" className="ui-button ui-button--primary" onClick={onNew}>
                <Icon name="plus" size={14} /> إنشاء مشروع
              </button>
              <button type="button" className="ui-button" onClick={onBrowse}>
                <Icon name="folderOpen" size={14} /> فتح مشروع
              </button>
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div className="home-filter-empty panel">
            <Icon name="search" size={18} />
            <p>لا توجد مشاريع مطابقة للبحث أو التصفية الحالية.</p>
            <button
              type="button"
              className="ui-button"
              onClick={() => { setQuery(""); onPrefs({ ...prefs, scope: "all" }); }}
            >
              إظهار كل المشاريع
            </button>
          </div>
        ) : (
          <div className={`home-cards home-cards--${prefs.view}`} role="list">
            {visible.map((item) => {
              const status = cardStatus(item);
              const isCurrent = currentKey === pathKey(item.path);
              return (
                <article
                  key={item.path}
                  className={`home-card ${isCurrent ? "is-current" : ""} ${item.pinned ? "is-pinned" : ""}`}
                  role="listitem"
                >
                  <button
                    type="button"
                    className="home-card-main"
                    onClick={() => onOpen(item.path)}
                  >
                    <span className="sr-only">{isCurrent ? "المشروع المفتوح حالياً: " : "فتح المشروع: "}</span>
                    <span className="home-card-thumb" aria-hidden="true">
                      <span className="home-card-glyph">أ</span>
                      <span className="home-card-upm" dir="ltr">{item.upm}</span>
                    </span>
                    <span className="home-card-copy">
                      <strong>{item.family || item.name}</strong>
                      <span className="home-card-sub">{item.style || "Regular"} · {item.name}</span>
                      <span className="home-card-path path" dir="ltr">{item.path}</span>
                      <span className="home-card-meta">
                        <span><Icon name="history" size={11} aria-hidden="true" /> {relativeTime(item.lastOpenedAt)}</span>
                        <span>{item.ready}/{item.slots} معتمدة</span>
                        {item.review > 0 ? <span>{item.review} للمراجعة</span> : null}
                      </span>
                    </span>
                  </button>
                  <div className="home-card-side">
                    <StatusChip tone={status.tone}>{status.label}</StatusChip>
                    <div className="home-card-actions">
                      <IconButton
                        icon="pin"
                        label={item.pinned ? "إلغاء تثبيت المشروع" : "تثبيت المشروع"}
                        size={13}
                        active={item.pinned}
                        onClick={() => onTogglePin(item.path)}
                      />
                      <IconButton
                        icon="trash"
                        label="إزالة المشروع من السجل المحلي"
                        size={13}
                        tone="danger"
                        onClick={() => onRemove(item.path)}
                      />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <p className="home-footnote">
          <Icon name="shield" size={12} aria-hidden="true" />
          إزالة المشروع من هذا السجل لا تحذف ملفاته من القرص. لا تُرسل بيانات المشاريع إلى أي خدمة شبكية.
        </p>
      </section>
    </section>
  );
}
