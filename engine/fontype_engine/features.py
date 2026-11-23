"""Generate Arabic OpenType feature code from the resolved project model.

The generator is deliberately conservative: it emits the four contextual form
features needed by the pinned joining types, optional lam-alef ligatures, and
lets ufo2ft derive GPOS/GDEF from the normalized UFO anchors. Designers never
edit this text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .source import ResolvedProject

FORM_FEATURE = {
    "initial": "init",
    "medial": "medi",
    "final": "fina",
}

LIGATURE_ALEF_NAMES = (
    "alef",
    "alefmadda",
    "alefhamzaabove",
    "alefhamzabelow",
)


@dataclass
class FeatureResult:
    text: str
    findings: list[dict[str, Any]] = field(default_factory=list)
    stats: dict[str, Any] = field(default_factory=dict)


def _slug(value: str) -> str:
    text = re.sub(r"[^A-Za-z0-9]+", "_", value.strip().lower()).strip("_")
    return text or "glyph"


def _finding(
    severity: str,
    code: str,
    message: str,
    hint: str,
    slot_id: str = "",
) -> dict[str, Any]:
    return {
        "severity": severity,
        "code": code,
        "message": message,
        "hint": hint,
        "slotId": slot_id,
    }


def _class(name: str, members: list[str]) -> str | None:
    unique = list(dict.fromkeys(members))
    if not unique:
        return None
    return f"@{name} = [{' '.join(unique)}];"


def _lookup(name: str, substitutions: list[tuple[str, str]]) -> str | None:
    if not substitutions:
        return None
    lines = [f"lookup {name} {{", "  lookupflag IgnoreMarks;"]
    lines.extend(f"  sub {source} by {target};" for source, target in substitutions)
    lines.append(f"}} {name};")
    return "\n".join(lines)


def generate(
    model: ResolvedProject,
    options: dict[str, Any] | None = None,
) -> FeatureResult:
    options = options or {}
    by_character: dict[str, dict[str, Any]] = {}
    joining: dict[str, str] = {}
    for glyph in model.glyphs:
        metadata = glyph.metadata
        if metadata.get("form") == "base" and metadata.get("group") == "space":
            continue
        character = _slug(
            str(metadata.get("characterName") or glyph.name.split(".")[0])
        )
        form = str(metadata.get("form") or "isolated")
        by_character.setdefault(character, {})[form] = glyph
        joining[character] = str(metadata.get("joiningType") or "U")

    join_prev: list[str] = []
    join_next: list[str] = []
    for character, forms in by_character.items():
        kind = joining.get(character, "U")
        if kind in {"D", "L"}:
            join_prev.extend(glyph.name for glyph in forms.values())
        if kind in {"D", "R"}:
            join_next.extend(glyph.name for glyph in forms.values())

    join_next_set = set(join_next)
    join_prev_set = set(join_prev)

    init_subs: list[tuple[str, str]] = []
    medi_subs: list[tuple[str, str]] = []
    fina_subs: list[tuple[str, str]] = []
    init_rules: list[str] = []
    medi_rules: list[str] = []
    fina_rules: list[str] = []

    for character, forms in sorted(by_character.items()):
        kind = joining.get(character, "U")
        isolated = forms.get("isolated")
        initial = forms.get("initial")
        medial = forms.get("medial")
        final = forms.get("fina") or forms.get("final")
        if final is None and "fina" in forms:
            final = forms["fina"]

        if kind in {"D", "L"} and isolated and initial:
            init_subs.append((isolated.name, initial.name))
            init_rules.append(f"  sub {isolated.name}' lookup FT_INIT @JOIN_NEXT;")
        if kind in {"D", "L"} and initial and medial:
            # HarfBuzz applies the joining features in the order init → medi →
            # fina. After `init`, the word-initial glyph is `.init` and the
            # remaining joiners are still `.isol`. The medial glyph is the one
            # that has both a preceding and a following joiner, so the rule
            # must target `.isol` with two-sided context — targeting `.init`
            # would only match the first glyph, which has no preceding joiner.
            # Include the initial→medial mapping too so manually selected
            # initial glyphs can still become medial in custom workflows.
            medi_subs.extend(
                [(isolated.name, medial.name), (initial.name, medial.name)]
            )
            if isolated:
                medi_rules.append(
                    f"  sub @JOIN_PREV {isolated.name}' lookup FT_MEDI @JOIN_NEXT;"
                )
        if kind in {"D", "R"} and final:
            for source in (isolated, initial, medial):
                if source is None:
                    continue
                fina_subs.append((source.name, final.name))
                # A backtrack-only contextual rule also matches word-final
                # glyphs, which have no following glyph in the buffer.
                fina_rules.append(f"  sub @JOIN_PREV {source.name}' lookup FT_FINA;")

    blocks: list[str] = ["languagesystem arab dflt;", ""]
    for name, members in (("JOIN_PREV", join_prev), ("JOIN_NEXT", join_next)):
        declaration = _class(name, members)
        if declaration:
            blocks.append(declaration)
    if any(
        _class(name, members)
        for name, members in (("JOIN_PREV", join_prev), ("JOIN_NEXT", join_next))
    ):
        blocks.append("")

    features: dict[str, tuple[str, list[str]]] = {
        "init": (_lookup("FT_INIT", init_subs) or "", init_rules),
        "medi": (_lookup("FT_MEDI", medi_subs) or "", medi_rules),
        "fina": (_lookup("FT_FINA", fina_subs) or "", fina_rules),
    }
    emitted: list[str] = []
    for feature, (lookup_block, rules) in features.items():
        if not rules or not lookup_block:
            continue
        blocks.append(lookup_block)
        blocks.append("")
        blocks.append(f"feature {feature} {{")
        blocks.extend(rules)
        blocks.append(f"}} {feature};")
        blocks.append("")
        emitted.append(feature)

    ligature_subs: list[tuple[str, str, str]] = []
    findings: list[dict[str, Any]] = []
    if options.get("lamAlefLigatures"):
        lam = by_character.get("lam", {})
        # `ccmp` runs before the positional init/medi/fina features, so the
        # ligature has to match the original isolated forms; by the time fina
        # runs the pair has already become lam.init + alef.fina (in RTL order).
        lam_isolated = lam.get("isolated")
        if not lam_isolated:
            findings.append(
                _finding(
                    "warning",
                    "SHAPING_LAM_ALEF_MISSING",
                    "خيار ligatures Lam-Alef مفعّل لكن شكل Lam المفرد غير مستورد.",
                    "استورد Lam.isolated أو عطّل خيار الوصلات.",
                    "lam.isolated",
                )
            )
        else:
            for alef_name in LIGATURE_ALEF_NAMES:
                alef = by_character.get(alef_name, {})
                alef_isolated = alef.get("isolated")
                if not alef_isolated:
                    continue
                ligature = next(
                    (
                        glyph
                        for glyph in model.glyphs
                        if glyph.name.startswith(f"lam_{alef_name}.")
                    ),
                    None,
                )
                if ligature is None:
                    findings.append(
                        _finding(
                            "warning",
                            "SHAPING_LIGATURE_ARTWORK_MISSING",
                            f"الوصلە Lam-{alef_name} مفعّلة لكن رسومها غير مستوردة.",
                            "استورد خانة ligature باسم lam_alef.* أو عطّل هذه الوصلة.",
                            f"lam.{alef_name}",
                        )
                    )
                    continue
                ligature_subs.append(
                    (lam_isolated.name, alef_isolated.name, ligature.name)
                )
            if ligature_subs:
                blocks.append("lookup FT_LAMALEF {")
                blocks.extend(
                    f"  sub {first} {second} by {result};"
                    for first, second, result in ligature_subs
                )
                blocks.append("} FT_LAMALEF;")
                blocks.append("")
                blocks.append("feature ccmp {")
                blocks.append("  lookup FT_LAMALEF;")
                blocks.append("} ccmp;")
                blocks.append("")
                emitted.append("ccmp")

    return FeatureResult(
        text="\n".join(blocks).rstrip() + "\n",
        findings=findings,
        stats={
            "features": emitted,
            "initRules": len(init_rules),
            "mediRules": len(medi_rules),
            "finaRules": len(fina_rules),
            "ligatureRules": len(ligature_subs),
            "joinPrevGlyphs": len(join_prev_set),
            "joinNextGlyphs": len(join_next_set),
        },
    )
