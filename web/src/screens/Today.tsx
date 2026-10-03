import { AnimatePresence, motion } from "motion/react";
import type { FeedCard, Idea } from "@shared/api";
import { api } from "../lib/client";
import { askAgent, doIdea } from "../lib/actions";
import { useKin } from "../lib/store";
import { useResource } from "../lib/useResource";
import { clock, longDate } from "../lib/time";
import { Avatar } from "../components/Avatar";
import { I, type IconName } from "../components/Icons";
import { Markdown } from "../components/Markdown";
import { TabScreen } from "../components/TabScreen";

const KIND: Record<FeedCard["kind"], { icon: IconName; color: string; label: string }> = {
  brief: { icon: "Sun", color: "var(--accent)", label: "Brief" },
  calendar: { icon: "Calendar", color: "#3D84D6", label: "Calendar" },
  email: { icon: "Mail", color: "#E0533D", label: "Email" },
  weather: { icon: "Cloud", color: "#4BA8DE", label: "Weather" },
  news: { icon: "News", color: "#8A8378", label: "News" },
  note: { icon: "Note", color: "#D9A21B", label: "Note" },
  goal: { icon: "Target", color: "#2A9A68", label: "Goal" },
};

function Brief({ card }: { card: FeedCard }) {
  const agent = useKin((s) => s.agent);
  return (
    <motion.article className="brief" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 30 }}>
      <div className="brief-avatar">
        <Avatar config={agent.avatar} size={76} state="idle" />
      </div>
      <div className="brief-kicker">
        Morning brief · {clock(card.createdAt)}
      </div>
      <h2 className="brief-title">{card.title}</h2>
      <Markdown text={card.body} className="brief-body" />
      {card.actions.length > 0 && (
        <div className="card-actions">
          {card.actions.map((a) => (
            <button key={a.label} type="button" className="chip chip-accent" onClick={() => askAgent(a.prompt)}>
              {a.label}
            </button>
          ))}
        </div>
      )}
      <div className="brief-sign">— {agent.name}</div>
    </motion.article>
  );
}

function Feed({ card, onDismiss }: { card: FeedCard; onDismiss: () => void }) {
  const k = KIND[card.kind] ?? KIND.note;
  const Icon = I[k.icon];
  return (
    <motion.article
      layout
      className="feed-card"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      exit={{ opacity: 0, x: -320, transition: { duration: 0.22 } }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0.7, right: 0.05 }}
      dragDirectionLock
      onDragEnd={(_, i) => (i.offset.x < -110 || i.velocity.x < -700) && onDismiss()}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
    >
      <div className="feed-head">
        <span className="feed-icon" style={{ background: k.color }}>
          <Icon size={17} />
        </span>
        <span className="feed-kind">{k.label}</span>
        <span className="feed-time">{clock(card.createdAt)}</span>
        <button type="button" className="feed-x" aria-label={`Dismiss ${card.title}`} onClick={onDismiss}>
          <I.X size={13} />
        </button>
      </div>
      <h3 className="feed-title">{card.title}</h3>
      <Markdown text={card.body} className="feed-body" />
      {card.actions.length > 0 && (
        <div className="card-actions">
          {card.actions.map((a) => (
            <button key={a.label} type="button" className="chip" onClick={() => askAgent(a.prompt)}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </motion.article>
  );
}

function IdeaCard({ idea, onDismiss }: { idea: Idea; onDismiss: () => void }) {
  return (
    <motion.article
      layout
      className="idea"
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
    >
      <span className="idea-icon">
        <I.Sparkle size={18} />
      </span>
      <h3>{idea.title}</h3>
      <p>{idea.why}</p>
      <div className="idea-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => doIdea(idea.id)}>
          Do it
        </button>
        <button type="button" className="icon-btn idea-x" aria-label={`Dismiss ${idea.title}`} onClick={onDismiss}>
          <I.X size={15} />
        </button>
      </div>
    </motion.article>
  );
}

export function Today() {
  const version = useKin((s) => s.versions.today);
  const agentName = useKin((s) => s.agent.name);
  const { data, setData, error, refresh } = useResource(() => api.today(), version);

  const dismissCard = (id: string) => {
    setData((d) => (d ? { ...d, cards: d.cards.filter((c) => c.id !== id) } : d));
    api.dismissCard(id).catch(() => {});
  };
  const dismissIdea = (id: string) => {
    setData((d) => (d ? { ...d, ideas: d.ideas.filter((c) => c.id !== id) } : d));
    api.dismissIdea(id).catch(() => {});
  };

  return (
    <TabScreen eyebrow={longDate(Date.now())} title="Today">

        {error && !data && (
          <div className="empty">
            <h3>Today didn't load</h3>
            <p>{error}</p>
            <button type="button" className="btn btn-soft" style={{ marginTop: 14 }} onClick={refresh}>
              Try again
            </button>
          </div>
        )}

        {data && (
          <>
            {data.brief ? (
              <Brief card={data.brief} />
            ) : (
              <div className="brief brief-empty">
                <p>
                  Your morning brief shows up here. {agentName} writes it each morning from your calendar, inbox and the weather.
                </p>
              </div>
            )}

            {data.ideas.length > 0 && (
              <section className="today-section">
                <h2 className="section-title">Ideas from {agentName}</h2>
                <div className="ideas scroll-x">
                  <AnimatePresence initial={false} mode="popLayout">
                    {data.ideas.map((i) => (
                      <IdeaCard key={i.id} idea={i} onDismiss={() => dismissIdea(i.id)} />
                    ))}
                  </AnimatePresence>
                </div>
              </section>
            )}

            <section className="today-section">
              <h2 className="section-title">Worth knowing</h2>
              <div className="feed">
                <AnimatePresence initial={false} mode="popLayout">
                  {data.cards.map((c) => (
                    <Feed key={c.id} card={c} onDismiss={() => dismissCard(c.id)} />
                  ))}
                </AnimatePresence>
                {data.cards.length === 0 && <p className="feed-empty">You're all caught up.</p>}
              </div>
            </section>
          </>
        )}
    </TabScreen>
  );
}
