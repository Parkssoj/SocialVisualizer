# -*- coding: utf-8 -*-
"""
Splits the final community_reports SFT pairs (finalize_pairs.py output) into
train/val, then converts each to ShareGPT 3-turn (system/human/gpt) JSONL for
LLaMA-Factory.
"""
import argparse
import json
import os
import random

MARKER = "Do not make anything up in your answer.\n"
VAL_RATIO = 0.08  # ~950 train / ~81 val, matching the split used for v5 training
SEED = 42


def split_system_human(instruction):
    idx = instruction.find(MARKER)
    if idx == -1:
        raise ValueError("split marker not found")
    split_at = idx + len(MARKER)
    return instruction[:split_at], instruction[split_at:]


def to_sharegpt_record(pair):
    system, human = split_system_human(pair["instruction"])
    return {
        "conversations": [
            {"from": "system", "value": system},
            {"from": "human", "value": human},
            {"from": "gpt", "value": pair["output"]},
        ]
    }


def write_jsonl(records, out_path):
    n_mail, n_msg = 0, 0
    with open(out_path, "w", encoding="utf-8") as f:
        for rec, meta in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            if meta["domain"] == "mail":
                n_mail += 1
            else:
                n_msg += 1
    print(f"{out_path} -> mail: {n_mail}  messenger: {n_msg}  total: {n_mail + n_msg}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-dir", default="./work")
    parser.add_argument("--out-dir", default=".")
    args = parser.parse_args()

    pairs = json.load(open(os.path.join(args.work_dir, "community_reports_pairs_v5.json"), encoding="utf-8"))

    rng = random.Random(SEED)
    shuffled = pairs[:]
    rng.shuffle(shuffled)
    n_val = max(1, round(len(shuffled) * VAL_RATIO))
    val_pairs, train_pairs = shuffled[:n_val], shuffled[n_val:]

    train_records = [(to_sharegpt_record(p), p["_meta"]) for p in train_pairs]
    val_records = [(to_sharegpt_record(p), p["_meta"]) for p in val_pairs]

    os.makedirs(args.out_dir, exist_ok=True)
    train_path = os.path.join(args.out_dir, "mailgrapher_v5_community_reports_train.jsonl")
    val_path = os.path.join(args.out_dir, "mailgrapher_v5_community_reports_val.jsonl")
    write_jsonl(train_records, train_path)
    write_jsonl(val_records, val_path)

    # sanity check one record
    with open(train_path, encoding="utf-8") as f:
        rec = json.loads(f.readline())
    print()
    print("=== sample check ===")
    for c in rec["conversations"]:
        print("FROM:", c["from"], "LEN:", len(c["value"]))


if __name__ == "__main__":
    main()
