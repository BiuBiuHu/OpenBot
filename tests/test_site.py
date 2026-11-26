import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SITE = REPO / "site"
EN_PAGE = SITE / "index.html"
ZH_PAGE = SITE / "zh" / "index.html"
WORKFLOWS = REPO / ".github" / "workflows"

CJK_RE = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")
EN_WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9+._/-]*")
LEADING_SLASH_ASSET = re.compile(r"""(?:href|src)=["'](/[^"']+)["']""")

ALLOWED_PHRASES = tuple(
    sorted(
        (
            "OpenBot",
            "OpenHands",
            "Chromium",
            "Personal Agent",
            "Anpai.Life",
            "Anpai",
            "GitHub",
            "Linux",
            "Ubuntu",
            "Node.js",
            "Node",
            "JavaScript",
            "Python",
            "LiteLLM",
            "OpenAI",
            "English",
            "Settings",
            "Host",
            "User",
            "Port",
            "Save and connect",
            "Initialize / check remote computer",
            "Initialize remote computer",
            "API Key",
            "API",
            "SSH",
            "CDP",
            "VNC",
            "Web",
            "ECS",
            "CLI",
            "MIT",
            "Alpha",
            "README",
            "Agent",
            "Git",
            "npm",
            "npx",
            "sudo",
            "root",
            "macOS",
            "x86_64",
            "systemd",
            "computer-use",
            "loopback",
        ),
        key=len,
        reverse=True,
    )
)

EN_MARKETING_ON_ZH = (
    "Give your personal agent a computer of its own",
    "What it does today",
    "Help only when needed",
    "Get started",
    "Honest limits",
    "Skip to content",
    "View on GitHub",
    "Bring your own server",
    "Alpha, on your machine",
    "This page is the product introduction",
)

ZH_MARKETING_ON_EN = (
    "让你自己的 ECS",
    "当前能做什么",
    "需要你时，再请你帮忙",
    "开始安装",
    "需要说清的边界",
    "跳到正文",
    "打开 GitHub",
    "自托管",
)


class VisibleTextParser(HTMLParser):
    SKIP_TAGS = {"script", "style", "pre", "code", "kbd", "samp", "noscript"}

    def __init__(self):
        super().__init__()
        self._skip = 0
        self._lang_switch = 0
        self.visible = []
        self.lang_switch = []
        self.hrefs = []
        self.srcs = []
        self.lang = ""
        self.ids = set()
        self.hreflang = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get("class", "").split()
        if tag == "html":
            self.lang = attrs.get("lang", "")
        if tag in self.SKIP_TAGS:
            self._skip += 1
        if "lang-switch" in classes:
            self._lang_switch += 1
        if tag == "a" and attrs.get("href"):
            self.hrefs.append(attrs["href"])
            if attrs.get("hreflang"):
                self.hreflang[attrs["hreflang"]] = attrs["href"]
        if tag == "link" and attrs.get("rel") == "alternate" and attrs.get("hreflang") and attrs.get("href"):
            self.hreflang[attrs["hreflang"]] = attrs["href"]
        if attrs.get("src"):
            self.srcs.append(attrs["src"])
        if attrs.get("href") and tag == "link":
            self.hrefs.append(attrs["href"])
        if attrs.get("id"):
            self.ids.add(attrs["id"])

    def handle_endtag(self, tag):
        if tag in self.SKIP_TAGS and self._skip:
            self._skip -= 1
        if tag == "nav" and self._lang_switch:
            self._lang_switch -= 1

    def handle_data(self, data):
        text = re.sub(r"\s+", " ", data).strip()
        if not text:
            return
        if self._skip:
            return
        if self._lang_switch:
            self.lang_switch.append(text)
            return
        self.visible.append(text)


def parse(path: Path) -> VisibleTextParser:
    parser = VisibleTextParser()
    parser.feed(path.read_text(encoding="utf-8"))
    parser.close()
    return parser


def strip_allowed(text: str) -> str:
    stripped = text
    for phrase in ALLOWED_PHRASES:
        stripped = re.sub(re.escape(phrase), " ", stripped, flags=re.I)
    stripped = re.sub(r"https?://\S+", " ", stripped)
    stripped = re.sub(r"v?\d+\.\d+(?:\.\d+)?", " ", stripped)
    stripped = re.sub(r"~/\S+", " ", stripped)
    return stripped


def leftover_english_runs(text: str) -> list[str]:
    stripped = strip_allowed(text)
    pattern = re.compile(r"(?:[A-Za-z][A-Za-z0-9+._/-]*[\s,;:：、/+\-–—'’]*){4,}")
    runs = []
    for match in pattern.finditer(stripped):
        chunk = match.group(0).strip()
        if len(EN_WORD_RE.findall(chunk)) >= 4:
            runs.append(chunk)
    return runs


class SiteTests(unittest.TestCase):
    def test_pages_exist(self):
        self.assertTrue(EN_PAGE.is_file())
        self.assertTrue(ZH_PAGE.is_file())
        self.assertTrue((SITE / ".nojekyll").is_file())
        self.assertTrue((SITE / "preview.py").is_file())

    def test_language_attributes_and_switch(self):
        en = parse(EN_PAGE)
        zh = parse(ZH_PAGE)
        self.assertEqual(en.lang, "en")
        self.assertTrue(zh.lang.startswith("zh"))
        self.assertIn("English", en.lang_switch)
        self.assertIn("中文", en.lang_switch)
        self.assertIn("English", zh.lang_switch)
        self.assertIn("中文", zh.lang_switch)
        self.assertTrue(any(href in {"zh/", "./zh/", "zh/index.html"} for href in en.hrefs))
        self.assertTrue(any(href in {"../", "../index.html"} for href in zh.hrefs))
        self.assertEqual(en.hreflang.get("zh-Hans"), "https://biubiuhu.github.io/OpenBot/zh/")
        self.assertEqual(zh.hreflang.get("en"), "https://biubiuhu.github.io/OpenBot/")

    def test_english_pages_have_no_chinese_marketing(self):
        html = EN_PAGE.read_text(encoding="utf-8")
        en = parse(EN_PAGE)
        body = " ".join(en.visible)
        self.assertFalse(CJK_RE.search(body), f"English page has Chinese copy: {CJK_RE.findall(body)}")
        for phrase in ZH_MARKETING_ON_EN:
            self.assertNotIn(phrase, html)

    def test_chinese_pages_have_no_english_marketing_sentences(self):
        html = ZH_PAGE.read_text(encoding="utf-8")
        zh = parse(ZH_PAGE)
        body = " ".join(zh.visible)
        for phrase in EN_MARKETING_ON_ZH:
            self.assertNotIn(phrase, html)
            self.assertNotIn(phrase, body)
        runs = leftover_english_runs(body)
        self.assertEqual(runs, [], f"Chinese page still has English marketing sentences: {runs}")

    def test_required_sections(self):
        for path in (EN_PAGE, ZH_PAGE):
            parsed = parse(path)
            for section_id in ("today", "help", "start", "limits"):
                self.assertIn(section_id, parsed.ids, path)

    def test_hero_wording_matches_readme(self):
        en = EN_PAGE.read_text(encoding="utf-8")
        zh = ZH_PAGE.read_text(encoding="utf-8")
        zh_text = re.sub(r"<[^>]+>", "", zh)
        self.assertIn("Give your personal agent a computer of its own.", en)
        self.assertIn("让你自己的 ECS，成为 Personal Agent 的手和脚。", zh_text)
        self.assertIn("Alpha", en)
        self.assertIn("MIT", en)
        self.assertIn("Self-hosted", en)
        self.assertIn("Alpha", zh)
        self.assertIn("MIT", zh)
        self.assertIn("自托管", zh)

    def test_github_and_readme_links(self):
        en = parse(EN_PAGE)
        zh = parse(ZH_PAGE)
        self.assertIn("https://github.com/BiuBiuHu/OpenBot", en.hrefs)
        self.assertIn("https://github.com/BiuBiuHu/OpenBot", zh.hrefs)
        self.assertIn("https://github.com/BiuBiuHu/OpenBot/blob/main/README.md", en.hrefs)
        self.assertIn("https://github.com/BiuBiuHu/OpenBot/blob/main/README.zh-CN.md", zh.hrefs)

    def test_install_commands_match_readme(self):
        for path in (EN_PAGE, ZH_PAGE):
            html = path.read_text(encoding="utf-8")
            self.assertIn("git clone https://github.com/BiuBiuHu/OpenBot.git", html)
            self.assertIn("npm ci", html)
            self.assertIn("npm run build", html)
            self.assertIn("npm run dev -- --port 3857", html)
            self.assertIn("Node.js ≥ 22.19.0", html)
            self.assertIn("Ubuntu 24.04", html)

    def test_claims_stay_inside_readme(self):
        en = EN_PAGE.read_text(encoding="utf-8")
        zh = ZH_PAGE.read_text(encoding="utf-8")
        self.assertIn("page elements and CDP", en)
        self.assertIn("not general pixel-based computer use", en)
        self.assertIn("页面元素与 CDP", zh)
        self.assertIn("并非覆盖所有 Linux 桌面应用的像素级 computer-use", zh)
        self.assertIn("Do not open them to the public internet", en)
        self.assertIn("不要把这些端口开放到公网", zh)
        self.assertIn("single user", en.lower())
        self.assertIn("单用户", zh)
        self.assertIn("Integration with Anpai, a calendar application, is planned", en)
        self.assertIn("未来计划接入安派（Anpai）", zh)
        self.assertNotIn("Dida", en)
        self.assertNotIn("Dida", zh)
        self.assertNotIn("dida", en.lower())
        self.assertNotIn("dida", zh.lower())

    def test_screenshots_are_repo_evidence(self):
        shots = (
            "computer-use-completed.png",
            "input-polish-desktop.png",
            "input-polish-mobile.png",
            "full-stack-completed.png",
        )
        en = parse(EN_PAGE)
        zh = parse(ZH_PAGE)
        for name in shots:
            self.assertTrue((SITE / "assets" / "screenshots" / name).is_file(), name)
            self.assertTrue(any(name in src for src in en.srcs), name)
            self.assertTrue(any(name in src for src in zh.srcs), name)
        en_html = EN_PAGE.read_text(encoding="utf-8")
        zh_html = ZH_PAGE.read_text(encoding="utf-8")
        self.assertIn("All data was synthetic", en_html)
        self.assertIn("empty demonstration forms", en_html)
        self.assertIn("全程使用演示数据", zh_html)
        self.assertIn("空白演示表单", zh_html)

    def test_base_path_safe_asset_urls(self):
        for path in (EN_PAGE, ZH_PAGE):
            html = path.read_text(encoding="utf-8")
            for match in LEADING_SLASH_ASSET.findall(html):
                self.assertTrue(
                    match.startswith("/OpenBot/") or match.startswith("#"),
                    f"{path} has a root-absolute URL that will break on GitHub Pages: {match}",
                )
            parsed = parse(path)
            for src in parsed.srcs:
                self.assertFalse(src.startswith("/"), src)
                self.assertIn("assets/", src)

    def test_preview_uses_github_pages_base_path(self):
        source = (SITE / "preview.py").read_text(encoding="utf-8")
        self.assertIn("/OpenBot", source)
        self.assertNotIn("/openbot", source)

    def test_pages_workflow_deploys_site_from_main(self):
        example = SITE / "pages.workflow.yml.example"
        self.assertTrue(example.is_file())
        self.assertIn("path: site", example.read_text(encoding="utf-8"))
        workflow = WORKFLOWS / "pages.yml"
        self.assertTrue(workflow.is_file(), "pages.yml must exist to publish GitHub Pages")
        text = workflow.read_text(encoding="utf-8")
        self.assertIn("path: site", text)
        self.assertIn("branches:", text)
        self.assertIn("main", text)
        self.assertIn("actions/deploy-pages", text)
        self.assertIn("actions/upload-pages-artifact", text)
        self.assertIn("enablement: true", text)

    def test_language_guard_detects_mixed_copy(self):
        self.assertTrue(
            leftover_english_runs("这是一套 for shipping consumer apps 的说明"),
            "mixed English marketing on a Chinese page should fail",
        )
        self.assertFalse(CJK_RE.search("Give your personal agent a computer of its own."))
        self.assertTrue(CJK_RE.search("让你自己的 ECS，成为 Personal Agent 的手和脚。"))


if __name__ == "__main__":
    unittest.main()
