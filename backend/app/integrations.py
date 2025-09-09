import os, base64, json
import httpx


class IntegrationError(Exception):
    pass


def create_jira_ticket(summary: str, description: str) -> dict:
    jira_url = os.getenv("JIRA_URL")
    jira_email = os.getenv("JIRA_EMAIL")
    jira_token = os.getenv("JIRA_API_TOKEN")
    project_key = os.getenv("JIRA_PROJECT_KEY")
    if not all([jira_url, jira_email, jira_token, project_key]):
        raise IntegrationError("JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY must be set")

    auth_bytes = f"{jira_email}:{jira_token}".encode("utf-8")
    auth_header = base64.b64encode(auth_bytes).decode("utf-8")

    payload = {
        "fields": {
            "project": {"key": project_key},
            "summary": summary,
            "description": description,
            "issuetype": {"name": "Task"},
        }
    }
    url = (jira_url or "").rstrip("/") + "/rest/api/3/issue"
    headers = {
        "Authorization": f"Basic {auth_header}",
        "Content-Type": "application/json",
    }

    with httpx.Client(timeout=30.0) as client:
        resp = client.post(url, headers=headers, json=payload)
        if resp.status_code >= 300:
            raise IntegrationError(f"Jira error: {resp.status_code} {resp.text}")
        return resp.json()


def publish_notion_page(title: str, content: str) -> dict:
    token = os.getenv("NOTION_API_TOKEN")
    database_id = os.getenv("NOTION_DATABASE_ID")
    if not token:
        raise IntegrationError("NOTION_API_TOKEN must be set")
    if not database_id:
        raise IntegrationError("NOTION_DATABASE_ID must be set")

    url = "https://api.notion.com/v1/pages"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
    }
    payload = {
        "parent": {"database_id": database_id},
        "properties": {
            "Name": {"title": [{"text": {"content": title[:200]}}]},
        },
        "children": [
            {
                "object": "block",
                "type": "paragraph",
                "paragraph": {
                    "rich_text": [{"type": "text", "text": {"content": content[:1900]}}]
                },
            }
        ],
    }

    with httpx.Client(timeout=30.0) as client:
        resp = client.post(url, headers=headers, json=payload)
        if resp.status_code >= 300:
            raise IntegrationError(f"Notion error: {resp.status_code} {resp.text}")
        return resp.json()


# --- Linear integration ---
def create_linear_issue(title: str, description: str) -> dict:
    api_key = os.getenv("LINEAR_API_KEY")
    team_id = os.getenv("LINEAR_TEAM_ID")
    if not api_key or not team_id:
        raise IntegrationError("LINEAR_API_KEY and LINEAR_TEAM_ID must be set")
    url = "https://api.linear.app/graphql"
    headers = {
        "Content-Type": "application/json",
        "Authorization": api_key,
    }
    query = {
        "query": "mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }",
        "variables": {
            "input": {
                "teamId": team_id,
                "title": title[:255],
                "description": description[:20000],
            }
        }
    }
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(url, headers=headers, json=query)
        if resp.status_code >= 300:
            raise IntegrationError(f"Linear error: {resp.status_code} {resp.text}")
        data = resp.json()
        if not data.get("data", {}).get("issueCreate", {}).get("success"):
            raise IntegrationError(f"Linear error: {json.dumps(data)}")
        return data["data"]["issueCreate"]["issue"]


# --- Confluence integration ---
def publish_confluence_page(space_key: str, title: str, content_html: str) -> dict:
    base = os.getenv("CONFLUENCE_BASE_URL")
    email = os.getenv("CONFLUENCE_EMAIL")
    token = os.getenv("CONFLUENCE_API_TOKEN")
    if not base or not email or not token or not space_key:
        raise IntegrationError("CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN, and space key required")
    url = base.rstrip("/") + "/rest/api/content"
    auth_bytes = f"{email}:{token}".encode("utf-8")
    auth_header = base64.b64encode(auth_bytes).decode("utf-8")
    headers = {
        "Authorization": f"Basic {auth_header}",
        "Content-Type": "application/json",
    }
    payload = {
        "type": "page",
        "title": title[:255],
        "space": {"key": space_key},
        "body": {
            "storage": {
                "value": content_html,
                "representation": "storage"
            }
        }
    }
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(url, headers=headers, json=payload)
        if resp.status_code >= 300:
            raise IntegrationError(f"Confluence error: {resp.status_code} {resp.text}")
        return resp.json()

