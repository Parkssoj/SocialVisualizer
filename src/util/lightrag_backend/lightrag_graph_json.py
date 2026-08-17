# src/util/lightrag_backend/lightrag_graph_json.py
#
# graphrag_parquet2json.py(GraphRAG 버전)의 LightRAG 대응 파일. GraphRAG는 parquet
# 여러 개(entities/relationships/communities)를 읽어서 그래프 시각화용 json을 만들었는데,
# LightRAG는 parquet이 없고 대신 지식그래프 전체를 NetworkX GraphML 파일 하나
# (graph_chunk_entity_relation.graphml, working_dir=paths.LIGHTRAG_OUTPUT_DIR 밑)로 저장한다.
# 여기서는 그 graphml을 읽어서 GraphRAG 버전과 동일한 {nodes, edges} JSON 스키마로
# 변환한다 — src/json/graph-render.js(프론트엔드)는 어느 엔진에서 온 데이터인지 몰라도
# 그대로 그릴 수 있게.
#
# 스키마는 맞추되, 일부 필드는 LightRAG에 대응 개념이 없어서 비워두거나 대체했다:
#   - human_readable_id: GraphRAG는 자체 부여한 정수 ID가 parquet에 있지만 LightRAG
#     그래프 노드/엣지에는 그런 필드가 없다. 여기서 그냥 순회 순서대로 0부터 매긴
#     인덱스를 대신 채운다 (프론트엔드 툴팁에 "#N"으로 표시되는 용도일 뿐, 의미 있는
#     식별자는 아니다).
#   - cluster/level: GraphRAG의 커뮤니티 계층(community hierarchy) 개념. LightRAG
#     기본 그래프에는 그런 클러스터링이 없어서 None으로 둔다.
#   - degree: parquet에 미리 계산되어 저장된 값 대신, 읽어온 그래프에서 그 자리에서
#     networkx로 계산한다 (graph.degree(node_id)) — 정확도는 동일하다.
#
# 주의(색상이 다르게 보일 수 있음): 이 프로젝트의 GraphRAG 프롬프트(extract_graph.j2)는
# EMAIL/PERSON/TOPIC/ORGANIZATION/LABEL/EVENT/ATTACHMENT라는 메일 전용 엔티티 타입을
# 쓰도록 커스터마이징돼 있는데, LightRAG는 기본 프롬프트를 쓰면 person/organization/
# geo/event 등 자체 분류를 내놓는다. graph-render.js의 색상 매핑(COLORS)에 없는 타입은
# 에러 없이 회색(unknown)으로만 표시된다 — 그래프 자체는 뜨지만 색 구분이 GraphRAG
# 버전만큼 세밀하지 않을 수 있다. LightRAG용 엔티티 타입 프롬프트를 따로 커스터마이징하면
# 해결되는데, 그건 이 파일의 범위 밖이라 언급만 해둔다.

import os
import json
import networkx as nx

_GRAPHML_FILENAME = "graph_chunk_entity_relation.graphml"  # lightrag_engine.py의 _get_storage_mtime과 동일한 파일명


def _convert(val):
    if val is None:
        return None
    if isinstance(val, str) and val == "":
        return None
    if isinstance(val, float):
        return round(val, 6)
    return val


def _build_nodes(graph: "nx.Graph") -> list[dict]:
    nodes = []
    for idx, (node_id, data) in enumerate(graph.nodes(data=True)):
        entity_type = data.get("entity_type")
        nodes.append({
            "id":                str(node_id),
            "label":             str(node_id),  # graph-render.js가 forceLink().id(d => d.label)로 엣지를 이 값에 연결하므로 id와 동일하게 맞춘다
            "entity_type":       str(entity_type).upper() if entity_type else None,
            "description":       _convert(data.get("description")),
            "human_readable_id": idx,
            "source_id":         _convert(data.get("source_id")),  # 이 엔티티가 나온 청크 id(들), GRAPH_FIELD_SEP로 join된 문자열
            "degree":            graph.degree(node_id),
            "weight":            _convert(data.get("weight")),
            "cluster":           None,  # LightRAG 기본 그래프엔 커뮤니티 개념이 없음
            "level":             None,
        })
    print(f"[GRAPH-JSON][lightrag] 노드 {len(nodes)}개 생성")
    return nodes


def _build_edges(graph: "nx.Graph") -> list[dict]:
    edges = []
    for idx, (src, tgt, data) in enumerate(graph.edges(data=True)):
        edges.append({
            "source":            str(src),
            "target":            str(tgt),
            "id":                _convert(data.get("id")) or str(idx),
            "human_readable_id": idx,
            "description":       _convert(data.get("description")),
            "weight":            _convert(data.get("weight", 1.0)),
            "source_id":         _convert(data.get("source_id")),
            "level":             None,
        })
    print(f"[GRAPH-JSON][lightrag] 엣지 {len(edges)}개 생성")
    return edges


# LightRAG의 graph_chunk_entity_relation.graphml을 읽어서 GraphRAG 버전과 동일한 형식의
# graph json으로 저장한다. job_run_lightrag.py의 build_graph_json()이 인덱싱/업데이트
# 완료 직후 이 함수를 호출한다 (기존에는 미구현 스텁이었음). 인덱싱이 이미 rag.finalize_storages()
# 까지 끝난 뒤에 호출되므로, LightRAG 내부 스토리지 락을 거치지 않고 파일을 직접 읽어도 안전하다.
def build_lightrag_graph_json(paths) -> dict:
    graphml_path = os.path.join(paths.LIGHTRAG_OUTPUT_DIR, _GRAPHML_FILENAME)

    if not os.path.exists(graphml_path):
        print(f"[GRAPH-JSON][lightrag] graphml 없음, 건너뜀: {graphml_path}")
        return {"nodes": [], "edges": []}

    graph = nx.read_graphml(graphml_path)

    print("노드 생성 중...")
    nodes = _build_nodes(graph)
    print("엣지 생성 중...")
    edges = _build_edges(graph)

    os.makedirs(os.path.dirname(paths.LIGHTRAG_GRAPH_JSON_PATH), exist_ok=True)
    graph_data = {"nodes": nodes, "edges": edges}

    with open(paths.LIGHTRAG_GRAPH_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(graph_data, f, ensure_ascii=False, indent=2)

    print(f"[GRAPH-JSON][lightrag] 저장 완료 → {paths.LIGHTRAG_GRAPH_JSON_PATH} (노드 {len(nodes)}, 엣지 {len(edges)})")
    return graph_data
