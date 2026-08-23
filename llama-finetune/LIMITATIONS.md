# 알려진 제한사항

## query(local_search/global_search) SFT 데이터 구축 스크립트는 재구성본입니다

`sft_data_construction/query/` 안의 8개 스크립트는 개발 당시 실행에 쓰인 원본이 아니라,
프로젝트 연구노트에 남아있는 알고리즘 설명을 근거로 다시 작성한 재구성본입니다. 실제
학습에 쓰인 최종 데이터(`mailgrapher_v5_local_search_*.jsonl`,
`mailgrapher_v5_global_search_*.jsonl`)는 원본이며 실제 학습 서버에 남아있는 것을
확인했습니다. 자세한 내용은 `sft_data_construction/query/README.md` 참고.

## 메신저 도메인의 extract_graph SFT 데이터는 근사 매칭 기반입니다

이메일 도메인은 GraphRAG 캐시 응답에 원본 메일의 고유 ID가 포함되어 있어 완전일치
매칭이 가능했지만, 메신저 청크에는 안정적인 ID가 없어 "채팅방 이름 + 날짜" 기반 근사
매칭을 사용했습니다(정확도 상세 수치는 `sft_data_construction/indexing/extract_graph_matching/`
및 프로젝트 연구노트 참고). 같은 날짜에 청크가 여러 개로 쪼개진 경우까지는 완전히
반영하지 못하는 한계가 있습니다.

## 원본 학습 데이터 파일은 레포지토리에 포함하지 않았습니다

학습에 사용한 원본 텍스트(합성 이메일/메신저 데이터)와 중간 산출물은 레포지토리에
포함하지 않았습니다. 전량 오프라인 단계에서 생성한 합성 데이터이며, 이 폴더의 스크립트로
재현 가능합니다.
