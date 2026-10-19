// Επιλογή emoji για το πεδίο γραψίματος. Στο κινητό υπάρχει ήδη στο
// πληκτρολόγιο· στον υπολογιστή όχι. Γραμμένα ως κωδικοί και όχι ως χαρακτήρες
// (δες τη σημείωση στο Conversation.tsx για το γιατί).

import React, { useEffect, useRef, useState } from "react";
import { Apple, Clock, Dog, Heart, Smile, Trophy, Hand } from "lucide-react";
import { t } from "../i18n";
import type { TKey } from "../i18n";

const GROUPS = {
  smileys: ["\u{1F600}", "\u{1F603}", "\u{1F604}", "\u{1F601}", "\u{1F606}", "\u{1F605}", "\u{1F923}", "\u{1F602}", "\u{1F642}", "\u{1F643}", "\u{1F609}", "\u{1F60A}", "\u{1F607}", "\u{1F970}", "\u{1F60D}", "\u{1F929}", "\u{1F618}", "\u{1F617}", "\u{1F61A}", "\u{1F60B}", "\u{1F61B}", "\u{1F61C}", "\u{1F92A}", "\u{1F61D}", "\u{1F917}", "\u{1F92D}", "\u{1F92B}", "\u{1F914}", "\u{1F910}", "\u{1F928}", "\u{1F610}", "\u{1F611}", "\u{1F636}", "\u{1F60F}", "\u{1F612}", "\u{1F644}", "\u{1F62C}", "\u{1F60C}", "\u{1F614}", "\u{1F62A}", "\u{1F634}", "\u{1F637}", "\u{1F912}", "\u{1F915}", "\u{1F922}", "\u{1F92E}", "\u{1F975}", "\u{1F976}", "\u{1F635}", "\u{1F92F}", "\u{1F920}", "\u{1F973}", "\u{1F60E}", "\u{1F913}", "\u{1F9D0}", "\u{1F615}", "\u{1F61F}", "\u{1F641}", "\u{1F62E}", "\u{1F62F}", "\u{1F632}", "\u{1F633}", "\u{1F97A}", "\u{1F626}", "\u{1F627}", "\u{1F628}", "\u{1F630}", "\u{1F625}", "\u{1F622}", "\u{1F62D}", "\u{1F631}", "\u{1F616}", "\u{1F623}", "\u{1F61E}", "\u{1F613}", "\u{1F629}", "\u{1F62B}", "\u{1F971}", "\u{1F624}", "\u{1F621}", "\u{1F620}", "\u{1F92C}", "\u{1F608}", "\u{1F480}", "\u{1F4A9}", "\u{1F921}", "\u{1F47B}", "\u{1F47D}", "\u{1F916}"],
  people: ["\u{1F44B}", "\u{1F91A}", "\u{270B}", "\u{1F596}", "\u{1F44C}", "\u{1F90F}", "\u{270C}\u{FE0F}", "\u{1F91E}", "\u{1F91F}", "\u{1F918}", "\u{1F919}", "\u{1F448}", "\u{1F449}", "\u{1F446}", "\u{1F447}", "\u{261D}\u{FE0F}", "\u{1F44D}", "\u{1F44E}", "\u{270A}", "\u{1F44A}", "\u{1F91B}", "\u{1F91C}", "\u{1F44F}", "\u{1F64C}", "\u{1F450}", "\u{1F932}", "\u{1F64F}", "\u{270D}\u{FE0F}", "\u{1F4AA}", "\u{1F9BE}", "\u{1F440}", "\u{1F441}\u{FE0F}", "\u{1F445}", "\u{1F444}", "\u{1F9E0}", "\u{1F476}", "\u{1F9D2}", "\u{1F466}", "\u{1F467}", "\u{1F9D1}", "\u{1F468}", "\u{1F469}", "\u{1F9D3}", "\u{1F474}", "\u{1F475}", "\u{1F64B}", "\u{1F646}", "\u{1F645}", "\u{1F937}", "\u{1F926}", "\u{1F481}", "\u{1F647}", "\u{1F9D1}\u{200D}\u{1F4BB}", "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}", "\u{1F483}", "\u{1F57A}", "\u{1F3C3}", "\u{1F6B6}", "\u{1F46B}", "\u{1F48F}", "\u{1F491}"],
  hearts: ["\u{2764}\u{FE0F}", "\u{1F9E1}", "\u{1F49B}", "\u{1F49A}", "\u{1F499}", "\u{1F49C}", "\u{1F90E}", "\u{1F5A4}", "\u{1F90D}", "\u{1F494}", "\u{2763}\u{FE0F}", "\u{1F495}", "\u{1F49E}", "\u{1F493}", "\u{1F497}", "\u{1F496}", "\u{1F498}", "\u{1F49D}", "\u{1F49F}", "\u{1F48B}", "\u{1F4AF}", "\u{1F4A2}", "\u{1F4A5}", "\u{1F4AB}", "\u{1F4A6}", "\u{1F4A8}", "\u{1F525}", "\u{2728}", "\u{2B50}", "\u{1F31F}", "\u{26A1}", "\u{1F389}", "\u{1F38A}", "\u{1F388}", "\u{1F381}", "\u{1F3C6}", "\u{1F947}", "\u{2705}", "\u{274C}", "\u{26A0}\u{FE0F}", "\u{2753}", "\u{2757}", "\u{1F4A4}", "\u{1F3B5}", "\u{1F3B6}"],
  nature: ["\u{1F436}", "\u{1F431}", "\u{1F42D}", "\u{1F439}", "\u{1F430}", "\u{1F98A}", "\u{1F43B}", "\u{1F43C}", "\u{1F428}", "\u{1F42F}", "\u{1F981}", "\u{1F42E}", "\u{1F437}", "\u{1F438}", "\u{1F435}", "\u{1F414}", "\u{1F427}", "\u{1F426}", "\u{1F986}", "\u{1F989}", "\u{1F434}", "\u{1F984}", "\u{1F41D}", "\u{1F98B}", "\u{1F40C}", "\u{1F41E}", "\u{1F422}", "\u{1F40D}", "\u{1F419}", "\u{1F42C}", "\u{1F433}", "\u{1F41F}", "\u{1F338}", "\u{1F339}", "\u{1F33B}", "\u{1F337}", "\u{1F331}", "\u{1F332}", "\u{1F334}", "\u{1F340}", "\u{1F341}", "\u{1F30D}", "\u{1F319}", "\u{2600}\u{FE0F}", "\u{26C5}", "\u{1F327}\u{FE0F}", "\u{2744}\u{FE0F}", "\u{1F308}", "\u{1F30A}"],
  food: ["\u{1F34F}", "\u{1F34E}", "\u{1F350}", "\u{1F34A}", "\u{1F34B}", "\u{1F34C}", "\u{1F349}", "\u{1F347}", "\u{1F353}", "\u{1F352}", "\u{1F351}", "\u{1F96D}", "\u{1F34D}", "\u{1F965}", "\u{1F95D}", "\u{1F345}", "\u{1F951}", "\u{1F966}", "\u{1F955}", "\u{1F33D}", "\u{1F336}\u{FE0F}", "\u{1F954}", "\u{1F950}", "\u{1F35E}", "\u{1F9C0}", "\u{1F95A}", "\u{1F373}", "\u{1F953}", "\u{1F354}", "\u{1F35F}", "\u{1F355}", "\u{1F32D}", "\u{1F96A}", "\u{1F32E}", "\u{1F957}", "\u{1F35D}", "\u{1F35C}", "\u{1F363}", "\u{1F364}", "\u{1F366}", "\u{1F369}", "\u{1F36A}", "\u{1F382}", "\u{1F370}", "\u{1F36B}", "\u{1F36C}", "\u{2615}", "\u{1F375}", "\u{1F37A}", "\u{1F37B}", "\u{1F942}", "\u{1F377}", "\u{1F943}", "\u{1F378}"],
  activity: ["\u{26BD}", "\u{1F3C0}", "\u{1F3C8}", "\u{26BE}", "\u{1F3BE}", "\u{1F3D0}", "\u{1F3D3}", "\u{1F3F8}", "\u{1F94A}", "\u{1F6B4}", "\u{1F3CA}", "\u{1F9D8}", "\u{1F3AE}", "\u{1F3B2}", "\u{1F3AF}", "\u{1F3A8}", "\u{1F3AC}", "\u{1F3A4}", "\u{1F3A7}", "\u{1F3B8}", "\u{1F3B9}", "\u{1F4DA}", "\u{270F}\u{FE0F}", "\u{1F4BC}", "\u{1F4BB}", "\u{1F4F1}", "\u{260E}\u{FE0F}", "\u{1F4F7}", "\u{1F4A1}", "\u{1F511}", "\u{1F3E0}", "\u{1F697}", "\u{1F695}", "\u{1F68C}", "\u{1F6B2}", "\u{2708}\u{FE0F}", "\u{1F680}", "\u{26F5}", "\u{1F3D6}\u{FE0F}", "\u{26F0}\u{FE0F}", "\u{1F5FA}\u{FE0F}", "\u{23F0}", "\u{1F4C5}", "\u{1F4B0}", "\u{1F393}", "\u{1F48A}", "\u{1F6D2}", "\u{1F9F3}"],
} as const;

type Group = keyof typeof GROUPS | "recent";

const ICONS: Record<Group, React.ReactNode> = {
  recent: <Clock size={17} />,
  smileys: <Smile size={17} />,
  people: <Hand size={17} />,
  hearts: <Heart size={17} />,
  nature: <Dog size={17} />,
  food: <Apple size={17} />,
  activity: <Trophy size={17} />,
};

const RECENT_KEY = "mila:emoji-recent";

function recent(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(list) ? list.filter((x) => typeof x === "string").slice(0, 32) : [];
  } catch {
    return [];
  }
}

function remember(emoji: string) {
  try {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([emoji, ...recent().filter((e) => e !== emoji)].slice(0, 32)),
    );
  } catch {
    // Ιδιωτική περιήγηση: δεν θυμόμαστε, δεν πειράζει.
  }
}

export function EmojiPicker({
  onPick,
  close,
}: {
  onPick: (emoji: string) => void;
  close: () => void;
}) {
  const [group, setGroup] = useState<Group>(() => (recent().length ? "recent" : "smileys"));
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!panel.current?.contains(target) && !target.closest(".emoji-toggle")) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [close]);

  const items = group === "recent" ? recent() : GROUPS[group];

  return (
    <div className="emoji-picker" ref={panel} role="dialog" aria-label={t("emoji.title")}>
      <div className="emoji-tabs">
        {(Object.keys(ICONS) as Group[]).map((g) => (
          <button
            key={g}
            className={g === group ? "on" : ""}
            onClick={() => setGroup(g)}
            aria-label={t(`emoji.${g}` as TKey)}
            title={t(`emoji.${g}` as TKey)}
          >
            {ICONS[g]}
          </button>
        ))}
      </div>
      <div className="emoji-grid">
        {items.map((emoji) => (
          <button
            key={emoji}
            onClick={() => {
              remember(emoji);
              onPick(emoji);
            }}
          >
            {emoji}
          </button>
        ))}
        {!items.length && <p className="hint">{t("emoji.noRecent")}</p>}
      </div>
    </div>
  );
}
