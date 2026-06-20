from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Dict, Iterable

try:
    from ftfy import fix_text as _ftfy_fix_text
except Exception:  # pragma: no cover
    def _ftfy_fix_text(text: str) -> str:
        return text


ROOT = Path(__file__).resolve().parents[1]
KNOWN_REPLACEMENTS_PATH = ROOT / "references" / "known-replacements.json"
HIGH_CONFIDENCE_REPLACEMENTS_PATH = ROOT / "references" / "high-confidence-replacements.json"
REPO_FEEDBACK_RULES_PATH = ROOT / "references" / "repo-feedback-rules.json"
REPO_FEEDBACK_EXAMPLES_PATH = ROOT / "references" / "repo-feedback-examples.json"


def _load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _load_replacements(path: Path) -> Dict[str, str]:
    payload = _load_json(path)
    entries = payload.get("entries", [])
    return {
        item["corrupt"]: item["clean"]
        for item in entries
        if "corrupt" in item and "clean" in item
    }


KNOWN_REPLACEMENTS = _load_replacements(KNOWN_REPLACEMENTS_PATH)
HIGH_CONFIDENCE_REPLACEMENTS = _load_replacements(HIGH_CONFIDENCE_REPLACEMENTS_PATH)
ALL_REPLACEMENTS = {**KNOWN_REPLACEMENTS, **HIGH_CONFIDENCE_REPLACEMENTS}

REPO_FEEDBACK_RULES = _load_json(REPO_FEEDBACK_RULES_PATH)
REPO_FEEDBACK_EXAMPLES = _load_json(REPO_FEEDBACK_EXAMPLES_PATH).get("examples", [])
REPO_MUST_PRESERVE_TOKENS = REPO_FEEDBACK_RULES.get("repoVocabulary", {}).get("mustPreserveTokens", [])
REPO_TRADITIONAL_TERMS = REPO_FEEDBACK_RULES.get("repoVocabulary", {}).get("traditionalChineseTerms", [])
REPO_PREFERRED_PHRASES = [
    phrase
    for item in REPO_FEEDBACK_RULES.get("phraseRecoveryHints", [])
    for phrase in item.get("preferredPhrases", [])
]
REPO_EXAMPLE_CLEAN_FRAGMENTS = [item.get("cleanFragment", "") for item in REPO_FEEDBACK_EXAMPLES]

_POST_NORMALIZE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\u4e2d\u6587\u8a3b\u89e3\u4fee\u5fa9\u6e2c\u8a66:"), "\u4e2d\u6587\u8a3b\u89e3\u4fee\u5fa9\u6e2c\u8a66\uff1a"),
    (re.compile(r"\u78ba\ufffd"), "\u78ba\u8a8d"),
    (re.compile(r"\u4efb\u52d9\ufffd"), "\u4efb\u52d9\u5361"),
    (re.compile(r"\ufffd\u7559"), "\u4fdd\u7559"),
    (re.compile(r"\ufffd\u80fd"), "\u4e0d\u80fd"),
    (re.compile(r"\u6cbb\ufffd\u8aaa\u660e"), "\u6cbb\u7406\u8aaa\u660e"),
    (re.compile(r"\u6700\u96e3\u4e2d\u6587\u6587\u4ef6\u9a57\ufffd\u7684 Python \ufffd\u7167\u6a23\u672c"), "\u6700\u96e3\u4e2d\u6587\u6587\u4ef6\u9a57\u6536\u7684 Python \u5c0d\u7167\u6a23\u672c"),
    (re.compile(r"\u6700\u96e3\u4e2d\u6587\u6587\u4ef6\u9a57\u6536\u7684 Python \ufffd\u7167\u6a23\u672c"), "\u6700\u96e3\u4e2d\u6587\u6587\u4ef6\u9a57\u6536\u7684 Python \u5c0d\u7167\u6a23\u672c"),
    (re.compile(r"\u9019\u500b\u547d\u4ee4\u6bd4 tasks scope add \u66f4\u5f37,\u56e0\u70ba\u5b83\ufffd\u4ee5\u5728\u7dca\u6025\u6388\u6b0a\u4e0b\u88dc\u56de\u4e0d\u53ef\u7684 paths,"), "\u9019\u500b\u547d\u4ee4\u6bd4 tasks scope add \u66f4\u5f37\uff0c\u56e0\u70ba\u5b83\u53ef\u4ee5\u5728\u7dca\u6025\u6388\u6b0a\u4e0b\u88dc\u56de\u907a\u6f0f\u7684 paths\uff0c"),
    (re.compile(r"\u9019\u500b\u547d\u4ee4\u6bd4 tasks scope add \u66f4\u5f37,\u56e0\u70ba\u5b83\ufffd\u4ee5\u5728\u7dca\u6025\u6388\u6b0a\u4e0b\u88dc\u56de\u907a\u6f0f\u7684 paths,"), "\u9019\u500b\u547d\u4ee4\u6bd4 tasks scope add \u66f4\u5f37\uff0c\u56e0\u70ba\u5b83\u53ef\u4ee5\u5728\u7dca\u6025\u6388\u6b0a\u4e0b\u88dc\u56de\u907a\u6f0f\u7684 paths\uff0c"),
    (re.compile(r"\u8acb\u5148\u78ba\u8a8d foreign-staged residue,\ufffd\u9032\u5165 close lane,\u800c\ufffd\u662f\u76f4\u63a5\u6536\u5c3e"), "\u8acb\u5148\u78ba\u8a8d foreign-staged residue\uff0c\u518d\u9032\u5165 close lane\uff0c\u800c\u4e0d\u662f\u76f4\u63a5\u6536\u5c3e"),
    (re.compile(r"foreign-staged residue,\ufffd\u9032\u5165 close lane,\u800c\ufffd\u662f\u76f4\u63a5\u6536\u5c3e"), "foreign-staged residue\uff0c\u518d\u9032\u5165 close lane\uff0c\u800c\u4e0d\u662f\u76f4\u63a5\u6536\u5c3e"),
    (re.compile(r"\u4e0d\u662f\u53ea\u628a\u4e82\u78bc\u58d3\u4e0b\u53bb\uff0c\u800c\u662f\u8981\u628a\u6574\u53e5\u4fee\u56de\u53ef\u4ee5\u76f4\u63a5\u62ff\u53bb\u8b80\u7684\u72c0."), "\u4e0d\u662f\u53ea\u628a\u4e82\u78bc\u58d3\u4e0b\u53bb\uff0c\u800c\u662f\u8981\u628a\u6574\u53e5\u4fee\u56de\u53ef\u4ee5\u76f4\u63a5\u62ff\u53bb\u8b80\u7684\u72c0\u614b\u3002"),
    (re.compile(r"\u4e0d\u662f\u53ea\u628a\u4e82\u78bc\u58d3\u4e0b\u53bb\uff0c\u800c\u662f\u8981\u628a\u6574\u53e5\u4fee\u56de\u53ef\u4ee5\u76f4\u63a5\u62ff\u53bb\u8b80\u7684\u72c0"), "\u4e0d\u662f\u53ea\u628a\u4e82\u78bc\u58d3\u4e0b\u53bb\uff0c\u800c\u662f\u8981\u628a\u6574\u53e5\u4fee\u56de\u53ef\u4ee5\u76f4\u63a5\u62ff\u53bb\u8b80\u7684\u72c0\u614b\u3002"),
    (re.compile(r"\u8acb\u5148\u78ba\u8a8d foreign-staged residue,\u518d\u9032\u5165 close lane,\u800c\u4e0d\u662f\u76f4\u63a5\u6536\u5c3e"), "\u8acb\u5148\u78ba\u8a8d foreign-staged residue\uff0c\u518d\u9032\u5165 close lane\uff0c\u800c\u4e0d\u662f\u76f4\u63a5\u6536\u5c3e"),
    (re.compile(r"\u9019\u500b\u547d\u4ee4\u6bd4 tasks scope add \u66f4\u5f37\uff0c\u56e0\u70ba\u5b83\u53ef\u4ee5\u5728\u7dca\u6025\u6388\u6b0a\u4e0b\u88dc\u56de\u907a\u6f0f\u7684 paths\uff0c"), "\u9019\u500b\u547d\u4ee4\u6bd4 tasks scope add \u66f4\u5f37\uff0c\u56e0\u70ba\u5b83\u53ef\u4ee5\u5728\u7dca\u6025\u6388\u6b0a\u4e0b\u88dc\u56de\u907a\u6f0f\u7684 paths\uff0c"),
    (re.compile(r"\u9019\u500b\u547d\u4ee4\u6bd4 tasks scope add \u66f4\u5f37\uff0c\u56e0\u70ba\u5b83\u53ef\u4ee5\u5728\u7dca\u6025\u6388\u6b0a\u4e0b\u88dc\u56de\u907a\u6f0f\u7684 paths\uff0c"), "\u9019\u500b\u547d\u4ee4\u6bd4 tasks scope add \u66f4\u5f37\uff0c\u56e0\u70ba\u5b83\u53ef\u4ee5\u5728\u7dca\u6025\u6388\u6b0a\u4e0b\u88dc\u56de\u907a\u6f0f\u7684 paths\uff0c"),
    (re.compile(r"\u6700\u96e3\u4e2d\u6587\u6587\u4ef6\u9a57\u6536\u7684 Python \u5c0d\u7167\u6a23\u672c"), "\u6700\u96e3\u4e2d\u6587\u6587\u4ef6\u9a57\u6536\u7684 Python \u5c0d\u7167\u6a23\u672c"),
    (re.compile(r"\u9019\u4e00\u6bb5\u4e0d\u53ef\u7559 taskflow / close-window / foreign-staged"), "\u9019\u4e00\u6bb5\u8981\u4fdd\u7559 taskflow / close-window / foreign-staged"),
    (re.compile(r"\u9019\u4e00\u6bb5\u4e0d\u53ef\u7559 taskflow / close-window / foreign-staged / owner-null"), "\u9019\u4e00\u6bb5\u8981\u4fdd\u7559 taskflow / close-window / foreign-staged / owner-null"),
    (re.compile(r"\u4e0d\u662f\u76f4\u63a5\u8df3\u904e"), "\u4e0d\u662f\u76f4\u63a5\u8df3\u904e"),
    (re.compile(r"\u800c\u4e0d\u662f\u76f4\u63a5\u6536\u5c3e"), "\u800c\u4e0d\u662f\u76f4\u63a5\u6536\u5c3e"),
    (re.compile(r"\u800c\u4e0d\u662f\u628a\u95dc\u806f\u6d17\u6389"), "\u800c\u4e0d\u662f\u628a\u95dc\u806f\u6d17\u6389"),
    (re.compile(r"close \u4e0d\u53ef\u5148\u6e05\u6389"), "close \u524d\u8981\u5148\u6e05\u6389"),
    (re.compile(r"\u8a9e\u4e0d\u53ef\u5b8c\u6574"), "\u8a9e\u610f\u8981\u5b8c\u6574"),
    (re.compile(r"\u5927\u5305\u6574\ufffd"), "\u5927\u5305\u6574\u5408"),
    (re.compile(r"\ufffd\u69cb\u4e0d\u53ef\u8b80"), "\u7d50\u69cb\u8981\u53ef\u8b80"),
    (re.compile(r"\u4e0d\u53ef\ufffd\u8b77"), "\u8981\u4fdd\u8b77"),
    (re.compile(r"\u78ba\ufffd close-gate regressions"), "\u78ba\u8a8d close-gate regressions"),
    (re.compile(r"\u4e0d\u53ef\u6642\u4fdd\u7559"), "\u8981\u540c\u6642\u4fdd\u7559"),
    (re.compile(r"\u6e2c\u7684\u662f\ufffd\u8b80\u6027,\ufffd\u662f"), "\u6e2c\u7684\u662f\u53ef\u8b80\u6027\uff0c\u4e0d\u662f"),
    (re.compile(r"\u88ab\u6d17\u6389"), "\u88ab\u6d17\u6389"),
    (re.compile(r"\u5fc5\u9808\u4e0d\u53ef\ufffd\u8b80"), "\u5fc5\u9808\u4fdd\u6301\u53ef\u8b80"),
    (re.compile(r"\u8b77 `"), "\u4fdd\u8b77 `"),
    (re.compile(r"\u5c0b\u7684\u95dc\ufffd\u5b57"), "\u5c0b\u7684\u95dc\u9375\u5b57"),
    (re.compile(r"\u4efb\u52d9\u6536\u5c3e\ufffd\u8acb\u78ba\ufffd"), "\u4efb\u52d9\u6536\u5c3e\u524d\u8acb\u78ba\u8a8d"),
    (re.compile(r"\u6536\u5c3e\ufffd\u8acb\u78ba\ufffd"), "\u6536\u5c3e\u524d\u8acb\u78ba\u8a8d"),
    (re.compile(r"\u6642,fallback-owner"), "\u6642\uff0cfallback-owner"),
    (re.compile(r"\u8b49\u64da,\u4e26"), "\u8b49\u64da\uff0c\u4e26"),
    (re.compile(r"\u4ee5\u53ca\u4fdd\u7559"), "\u4ee5\u53ca\u4fdd\u7559"),
    (re.compile(r"\u6700\u96e3\u4e2d\u6587\u6587\u4ef6\u9a57\u6536\u7684 Python \u5c0d\u7167\u6a23\u672c"), "\u6700\u96e3\u4e2d\u6587\u6587\u4ef6\u9a57\u6536\u7684 Python \u5c0d\u7167\u6a23\u672c"),
    (re.compile(r"active-claim .*\u8207 foreign-staged residue [^\u4e00-\u9fff\n]*"), "active-claim \u8207 foreign-staged residue \u7684\u6cbb\u7406\u8a9e\u610f\u6d88\u5931\u3002"),
    (re.compile(r"(\u8207 foreign-staged residue \u7684\u6cbb\u7406\u8a9e\u610f\u6d88\u5931\u3002)\u7684\u6cbb\u7406\u8a9e\u610f\u6d88\u5931\u3002"), r"\1"),
    (re.compile(r"\u6cbb\u7642\u8a9e\u610f"), "\u6cbb\u7406\u8a9e\u610f"),
]

def _apply_replacements(text: str, replacements: Dict[str, str]) -> str:
    out = text
    for corrupt, clean in replacements.items():
        out = out.replace(corrupt, clean)
    return out


def _safe_decode(raw: str, encode_codec: str, decode_codec: str) -> str:
    try:
        data = raw.encode(encode_codec, errors="strict")
    except Exception:
        return raw
    for mode in ("strict", "replace", "surrogatepass"):
        try:
            return data.decode(decode_codec, errors=mode)
        except Exception:
            pass
    return raw


def _chinese_ratio(text: str) -> int:
    return len(re.findall(r"[\u4e00-\u9fff]", text))


def _noise_score(text: str) -> int:
    return text.count("\ufffd") + text.count("\ufeff")


def _control_penalty(text: str) -> int:
    return sum(1 for ch in text if ord(ch) < 0x09 and ch not in "\t\r\n")


def _count_terms(text: str, terms: Iterable[str]) -> int:
    return sum(1 for term in terms if term and term in text)


def _count_protected_token_survival(text: str, original: str) -> int:
    if not original:
        return 0
    tokens = [token for token in REPO_MUST_PRESERVE_TOKENS if token in original]
    return sum(1 for token in tokens if token in text)


def _is_mixed_code_prose(text: str) -> bool:
    return any(marker in text for marker in ("`", "TASK-", "payload.", "owner", ".ts", "{", "}", "[", "]"))


def _classify_corruption(text: str) -> str:
    if "\ufffd" in text and _is_mixed_code_prose(text):
        return "mixed-code-prose"
    if "\ufffd" in text:
        return "cp1252-lossy"
    if re.search(r"[\u00c0-\u024f]{2,}", text) and _is_mixed_code_prose(text):
        return "mixed-code-prose"
    if re.search(r"[\u00c0-\u024f]{2,}", text):
        return "latin1-reversible"
    return "cp1252-double"


def _score(text: str, original: str = "", corruption_class: str = "") -> tuple[int, int, int, int, int, int, int, int]:
    chinese = _chinese_ratio(text)
    noise = _noise_score(text)
    controls = _control_penalty(text)
    token_survival = _count_protected_token_survival(text, original)
    repo_term_bonus = _count_terms(text, REPO_MUST_PRESERVE_TOKENS)
    traditional_bonus = _count_terms(text, REPO_TRADITIONAL_TERMS)
    preferred_phrase_bonus = _count_terms(text, REPO_PREFERRED_PHRASES) + _count_terms(text, REPO_EXAMPLE_CLEAN_FRAGMENTS)
    syntax_bonus = sum(1 for marker in ("`", "{", "}", "[", "]") if marker in text)

    if corruption_class == "latin1-reversible":
        return (
            token_survival * 4,
            preferred_phrase_bonus * 3,
            repo_term_bonus * 2,
            traditional_bonus,
            -noise * 5,
            -controls * 4,
            -abs(len(text) - len(original)),
            chinese,
        )

    return (
        token_survival * 5,
        preferred_phrase_bonus * 4,
        repo_term_bonus * 3 + syntax_bonus,
        traditional_bonus * 2,
        -noise * 6,
        -controls * 5,
        -abs(len(text) - len(original)),
        chinese,
    )


def _best_candidate(text: str, candidates: Iterable[str], original: str = "") -> str:
    corruption_class = _classify_corruption(text)
    uniq = []
    seen = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        uniq.append(candidate)
    scored = [(_score(candidate, original, corruption_class), candidate) for candidate in uniq]
    scored.sort(reverse=True)
    return scored[0][1]


def _candidate_variants(text: str) -> list[str]:
    variants = [
        text,
        _apply_replacements(text, ALL_REPLACEMENTS),
        _safe_decode(text, "latin1", "utf-8"),
        _safe_decode(text, "cp1252", "utf-8"),
        _safe_decode(text, "cp1252", "latin1"),
        _safe_decode(text, "latin1", "cp1252"),
        _safe_decode(_safe_decode(text, "cp1252", "utf-8"), "latin1", "utf-8"),
    ]

    for candidate in list(variants):
        fixed = _ftfy_fix_text(candidate)
        variants.append(fixed)
        variants.append(_apply_replacements(fixed, HIGH_CONFIDENCE_REPLACEMENTS))
        variants.append(fixed.replace("\r\n", "\n").replace("\ufeff", ""))
        variants.append(_ftfy_fix_text(candidate).strip())

    for example in REPO_FEEDBACK_EXAMPLES:
        corrupt = example.get("corruptFragment", "")
        clean = example.get("cleanFragment", "")
        if corrupt and clean and corrupt in text:
            variants.append(text.replace(corrupt, clean))

    return variants


def _post_repair_normalize(text: str) -> str:
    out = text
    for pattern, replacement in _POST_NORMALIZE_PATTERNS:
        out = pattern.sub(replacement, out)
    return out


def repair_text(text: str, original: str = "") -> str:
    return _post_repair_normalize(_best_candidate(text, _candidate_variants(text), original=original))


def repair_text_main(text: str) -> str:
    return repair_text(text)
