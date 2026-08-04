import json
from jinja2 import Environment, FileSystemLoader
from pathlib import Path


class PromptTemplate:
    WORKFLOW_NAMES = {
        "extract_graph", "summarize_descriptions", "extract_claims", "community_reports", "local_search", "global_search"
    }
    NESTED_WORKFLOWS = {
        "global_search" : ["map", "reduce", "knowledge"]
    }

    # 생성자
    def __init__(self, domain: str):
        self.domain = domain
        self.config_path = Path(__file__).parent/"configs"/f"{domain}.json"
        self.output_dir = Path(__file__).parent.parent/"rendered"/domain

        if not self.config_path.exists():
            raise FileNotFoundError(f"config not found: {self.config_path}")

        self.env = Environment(loader=FileSystemLoader(str(Path(__file__).parent/"prompts")), trim_blocks=True, lstrip_blocks=True)

    # 렌더링 결과물(rendered/{domain}/)을 담을 디렉터리를 준비, 없으면 생성
    def _ensure_output_dir(self) -> Path:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        return self.output_dir

    # 템플릿(name.j2)를 렌더링해서 prompts/name.txt로 저장
    def _render_one(self, name: str, context: dict, prompts_dir: Path):
        template = self.env.get_template(f"{name}.j2")
        rendered = template.render(**context)   # j2 템플릿의 context에 실제 값을 채워 완성된 문자열을 리턴

        assert "{{" not in rendered and "{%" not in rendered, f"unrendered tag left in {name}.txt"     # 렌더링 성공 여부 검사. 잔존 태그가 있으면 에러 발생

        output_path = prompts_dir/f"{name}.txt"
        output_path.write_text(rendered, encoding="utf-8")
        print(f"[render] {output_path}")

    # config.json을 읽어서 워크플로우별로 프롬프트 템플릿을 렌더링
    def render(self):
        with open(self.config_path, encoding="utf-8") as file:
            config = json.load(file)

        # workflow를 제외한 나머지 키들이 공유하는 값
        shared = {k: v for k, v in config.items() if k not in self.WORKFLOW_NAMES}  

        prompts_dir = self._ensure_output_dir()/"prompts"
        prompts_dir.mkdir(parents=True, exist_ok=True)

        for workflow in self.WORKFLOW_NAMES:
            value = config.get(workflow)
            if value is None:
                print(f"[skip] {self.domain}: {workflow} not configured")
                continue

            if workflow in self.NESTED_WORKFLOWS:   # 하위 구조를 가진 경우 (global_search)
                for sub in  self.NESTED_WORKFLOWS[workflow]:
                    sub_value = value.get(sub)
                    if sub_value is None:
                        print(f"[skip] {self.domain}: {workflow}.{sub} not configured")
                        continue
                    self._render_one(f"{workflow}_{sub}", {**shared, **sub_value}, prompts_dir)
            else:
                self._render_one(workflow, {**shared, **value}, prompts_dir)

if __name__ == "__main__":
    renderer = PromptTemplate("base")
    renderer.render()