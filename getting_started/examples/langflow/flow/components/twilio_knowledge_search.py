from langflow.custom import Component
from langflow.inputs import StrInput, SecretStrInput, IntInput
from langflow.template import Output
from langflow.field_typing import Tool


class TwilioKnowledgeSearchTool(Component):
    display_name = "Twilio Knowledge Search"
    description = "Search a Twilio Enterprise Knowledge base. Returns a Tool the agent can call."
    icon = "search"
    name = "TwilioKnowledgeSearch"

    inputs = [
        StrInput(
            name="kb_id",
            display_name="Knowledge Base ID",
            info="The Twilio KB ID, e.g. know_knowledgebase_xxxxxxxxxxxx",
            required=True,
        ),
        SecretStrInput(
            name="api_key_sid",
            display_name="Twilio API Key SID",
            info="The SK... API Key SID (not the Account SID).",
            required=True,
        ),
        SecretStrInput(
            name="api_key_secret",
            display_name="Twilio API Key Secret",
            required=True,
        ),
        StrInput(
            name="tool_name",
            display_name="Tool Name",
            value="search_knowledge_base",
            info=(
                "Name the LLM sees when deciding whether to call the tool. "
                "Must match what the system prompt references."
            ),
        ),
        StrInput(
            name="tool_description",
            display_name="Tool Description",
            value=(
                "Search the company knowledge base to answer the customer's "
                "questions about products, services, policies, or procedures. "
                "Use before answering factual questions. Do not answer from "
                "memory — search first."
            ),
            info=(
                "Primary signal the LLM uses to decide whether to call the tool. "
                "Be specific about WHEN to use it; vague descriptions kill tool-use."
            ),
        ),
        IntInput(
            name="default_top",
            display_name="Default top",
            value=5,
            info="How many chunks to return per call (1-20).",
        ),
    ]

    outputs = [Output(name="tool", display_name="Tool", method="build_tool")]

    def build_tool(self) -> Tool:
        import requests
        from base64 import b64encode
        from pydantic import BaseModel, Field
        from langchain_core.tools import StructuredTool

        kb_id = self.kb_id
        api_key_sid = self.api_key_sid
        api_key_secret = self.api_key_secret
        default_top = max(1, min(self.default_top, 20))

        class SearchInput(BaseModel):
            query: str = Field(
                description="The customer's question about products, services, or policies."
            )

        def run(query: str) -> str:
            url = f"https://knowledge.twilio.com/v2/KnowledgeBases/{kb_id}/Search"
            auth = b64encode(f"{api_key_sid}:{api_key_secret}".encode()).decode()
            try:
                resp = requests.post(
                    url,
                    headers={
                        "Authorization": f"Basic {auth}",
                        "Content-Type": "application/json",
                    },
                    json={"query": query, "top": default_top},
                    timeout=30,
                )
                resp.raise_for_status()
            except requests.exceptions.RequestException as e:
                return f"Error querying the knowledge base: {e}"

            chunks = resp.json().get("chunks", [])
            if not chunks:
                return "No relevant content found for that question."
            return "\n\n".join(
                f"[{i + 1}] {c.get('content', '')}" for i, c in enumerate(chunks)
            )

        return StructuredTool.from_function(
            name=self.tool_name,
            description=self.tool_description,
            func=run,
            args_schema=SearchInput,
        )
