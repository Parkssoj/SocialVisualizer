# -*- coding: utf-8 -*-
"""
Builds community_reports SFT pairs directly from production gold reports for
communities within the token budget. Communities that exceed the budget are
written to oversized_cases.json for hand-written gold (see compose_oversized.py).
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_context import load_domain, build_local_contexts

ROOMS = [
    "0827e9a2", "1422f5f2", "4d4d567a", "823e7fcd", "afb96430", "b8378282",
    "c2248847", "c8a7c88a", "ca4130a6", "cb5deed9", "d26b54b6", "d93f9d2f", "f7792b49",
]

MAX_INPUT_TOKENS = 5500
MAX_REPORT_LENGTH = 2000  # community_reports.max_length in settings.j2

# Rendered production prompts live in the main app repo, two levels above this
# folder (llama-finetune/sft_data_construction/indexing/ -> repo root -> parquet_template).
DEFAULT_PROMPTS_DIR = Path(__file__).resolve().parents[3] / "parquet_template" / "rendered"


def build_domains(raw_data_dir: str):
    domains = [("mail", "mail", os.path.join(raw_data_dir, "Llama_mail_output/Llama_mail_output/output"))]
    for r in ROOMS:
        domains.append((
            "messenger", r,
            os.path.join(raw_data_dir, f"Llama_messenger_output/Llama_messenger_output/msg_{r}/graphrag/parquet/output"),
        ))
    return domains


def load_prompts(prompts_dir: Path):
    return {
        "mail": (prompts_dir / "mail" / "prompts" / "community_reports.txt").read_text(encoding="utf-8"),
        "messenger": (prompts_dir / "messenger" / "prompts" / "community_reports.txt").read_text(encoding="utf-8"),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-data-dir", default="./raw_data",
                         help="GraphRAG output root containing Llama_mail_output/ and Llama_messenger_output/")
    parser.add_argument("--prompts-dir", default=str(DEFAULT_PROMPTS_DIR),
                         help="Root containing {mail,messenger}/prompts/community_reports.txt")
    parser.add_argument("--work-dir", default="./work")
    args = parser.parse_args()

    os.makedirs(args.work_dir, exist_ok=True)
    prompts = load_prompts(Path(args.prompts_dir))

    pairs = []
    oversized = []  # needs hand-written gold (see compose_oversized.py)

    for domain, room, base in build_domains(args.raw_data_dir):
        entities, relationships, communities, reports = load_domain(base)
        full_ctx = build_local_contexts(entities, relationships, communities, max_context_tokens=None)
        trimmed_ctx = build_local_contexts(entities, relationships, communities, max_context_tokens=MAX_INPUT_TOKENS)

        for (cid, level), info in full_ctx.items():
            rep_row = reports[(reports["community"] == cid) & (reports["level"] == level)]
            if len(rep_row) != 1:
                continue
            gold_json = rep_row.iloc[0]["full_content_json"]

            if info["context_size"] <= MAX_INPUT_TOKENS:
                ctx = info["context_string"]
                prompt = prompts[domain].format(input_text=ctx, max_report_length=str(MAX_REPORT_LENGTH))
                pairs.append({
                    "instruction": prompt,
                    "input": "",
                    "output": gold_json,
                    "_meta": {
                        "domain": domain, "room": room, "community": int(cid), "level": int(level),
                        "n_entities": int(info["n_entities"]), "context_tokens_approx": int(info["context_size"]),
                        "source": "original_gold",
                    },
                })
            else:
                tinfo = trimmed_ctx[(cid, level)]
                oversized.append({
                    "domain": domain, "room": room, "community": int(cid), "level": int(level),
                    "n_entities": int(info["n_entities"]), "full_tokens": int(info["context_size"]),
                    "trimmed_tokens": int(tinfo["context_size"]), "trimmed_context": tinfo["context_string"],
                })

    print("normal pairs (direct gold reuse):", len(pairs))
    print("oversized -> needs hand-written gold:", len(oversized))

    with open(os.path.join(args.work_dir, "pairs_normal.json"), "w", encoding="utf-8") as f:
        json.dump(pairs, f, ensure_ascii=False, indent=2)

    with open(os.path.join(args.work_dir, "oversized_cases.json"), "w", encoding="utf-8") as f:
        json.dump(oversized, f, ensure_ascii=False, indent=2)

    for o in oversized:
        print(f"- {o['domain']}/{o['room']} community={o['community']} level={o['level']} "
              f"n_entities={o['n_entities']} full_tokens={o['full_tokens']} trimmed_tokens={o['trimmed_tokens']}")


if __name__ == "__main__":
    main()
