"""
Faithful reconstruction of GraphRAG's community_reports input context,
mirroring graphrag/index/operations/summarize_communities/graph_context/{context_builder,sort_context}.py
and graphrag/index/workflows/create_community_reports.py (_prep_nodes/_prep_edges/explode_communities).

Used to rebuild SFT training pairs (input context <-> gold full_content_json) for the
community_reports task, from the GraphRAG output artifacts for the mail corpus and the
13-room messenger corpus (Llama_mail_output / Llama_messenger_output).
"""
import json
import os
import re
import pandas as pd

# No network access to download a real BPE tokenizer here, so use a rough proxy:
# each CJK/Hangul character ~= 1 token (close to real BPE behavior for Korean),
# other text tokenized by whitespace-splitting with ~1 token/word.
# This is only used to decide which communities are anomalously large and need
# careful (trimmed / hand-written) treatment -- not for exact production parity.
_CJK_RE = re.compile(r"[ㄱ-힝一-鿿]")

def num_tokens(s: str) -> int:
    if not s:
        return 0
    cjk_chars = _CJK_RE.findall(s)
    non_cjk = _CJK_RE.sub(" ", s)
    words = non_cjk.split()
    return len(cjk_chars) + len(words)

# ---- faithful port of graphrag's context building ----

def prep_nodes(entities: pd.DataFrame) -> pd.DataFrame:
    df = entities.copy()
    df["description"] = df["description"].fillna("No Description")
    df["node_details"] = df[["human_readable_id", "title", "description", "degree"]].to_dict(orient="records")
    return df

def prep_edges(relationships: pd.DataFrame) -> pd.DataFrame:
    df = relationships.copy()
    df["description"] = df["description"].fillna("No Description")
    df["edge_details"] = df[["human_readable_id", "source", "target", "description", "combined_degree"]].to_dict(orient="records")
    return df

def explode_communities(communities: pd.DataFrame, entities: pd.DataFrame) -> pd.DataFrame:
    community_join = communities.explode("entity_ids").loc[:, ["community", "level", "entity_ids"]]
    nodes = entities.merge(community_join, left_on="id", right_on="entity_ids", how="left")
    return nodes.loc[nodes["community"] != -1]

def _get_context_string(entities, edges):
    contexts = []
    for label, data in [("Entities", entities), ("Relationships", edges)]:
        if data:
            data_df = pd.DataFrame(data)
            if not data_df.empty:
                contexts.append(f"-----{label}-----\n{data_df.to_csv(index=False, sep=',')}")
    return "\n\n".join(contexts)

def sort_context(local_context: list, max_context_tokens=None):
    """Faithful port of sort_context.py (no claims, since extract_claims is disabled)."""
    edges = [
        {**e, "human_readable_id": int(e["human_readable_id"])}
        for record in local_context
        for e in record.get("edge_details", [])
        if isinstance(e, dict)
    ]
    node_details = {
        record["title"]: {**record["node_details"], "human_readable_id": int(record["node_details"]["human_readable_id"])}
        for record in local_context
    }
    edges.sort(key=lambda x: (-x.get("combined_degree", 0), x.get("human_readable_id", "")))

    edge_ids, node_ids = set(), set()
    sorted_edges, sorted_nodes = [], []
    context_string = ""
    truncated = False

    for edge in edges:
        source, target = edge["source"], edge["target"]
        for node in [node_details.get(source), node_details.get(target)]:
            if node and node["human_readable_id"] not in node_ids:
                node_ids.add(node["human_readable_id"])
                sorted_nodes.append(node)
        if edge["human_readable_id"] not in edge_ids:
            edge_ids.add(edge["human_readable_id"])
            sorted_edges.append(edge)

        new_context_string = _get_context_string(sorted_nodes, sorted_edges)
        if max_context_tokens and num_tokens(new_context_string) > max_context_tokens:
            truncated = True
            break
        context_string = new_context_string

    if not context_string:
        context_string = _get_context_string(sorted_nodes, sorted_edges)

    return context_string, truncated

def build_local_contexts(entities: pd.DataFrame, relationships: pd.DataFrame, communities: pd.DataFrame, max_context_tokens=None):
    """Returns a dict: (community_id, level) -> {"context_string", "context_size", "truncated", "n_entities", "n_relationships"}"""
    nodes = explode_communities(communities, entities)
    nodes = prep_nodes(nodes)
    edges = prep_edges(relationships)

    results = {}
    levels = sorted(nodes["level"].dropna().unique().tolist())
    for level in levels:
        level_nodes = nodes[nodes["level"] == level]
        nodes_set = set(level_nodes["title"])
        level_edges = edges[edges["source"].isin(nodes_set) & edges["target"].isin(nodes_set)]

        # group edge_details by node (source or target) - first occurrence, mirroring the pandas groupby.agg("first") in context_builder.py
        edge_by_source = level_edges.groupby("source")["edge_details"].first()
        edge_by_target = level_edges.groupby("target")["edge_details"].first()

        for community_id, grp in level_nodes.groupby("community"):
            all_context = []
            for _, row in grp.iterrows():
                title = row["title"]
                # mirrors production: combine_first(source_edge, target_edge) then list(x.dropna())
                # i.e. AT MOST ONE edge_details dict is attached per node (a real quirk of this
                # graphrag version's context builder -- faithfully replicated here)
                ed = edge_by_source.get(title)
                if ed is None:
                    ed = edge_by_target.get(title)
                all_context.append({
                    "title": title,
                    "node_details": row["node_details"],
                    "edge_details": [ed] if isinstance(ed, dict) else [],
                })
            context_string, truncated = sort_context(all_context, max_context_tokens=max_context_tokens)
            results[(int(community_id), int(level))] = {
                "context_string": context_string,
                "context_size": num_tokens(context_string),
                "truncated": truncated,
                "n_entities": len(grp),
            }
    return results


def load_domain(base_dir):
    entities = pd.read_parquet(os.path.join(base_dir, "entities.parquet"))
    relationships = pd.read_parquet(os.path.join(base_dir, "relationships.parquet"))
    communities = pd.read_parquet(os.path.join(base_dir, "communities.parquet"))
    community_reports = pd.read_parquet(os.path.join(base_dir, "community_reports.parquet"))
    return entities, relationships, communities, community_reports
