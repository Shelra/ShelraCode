"""Recall aid for the phase 1 labels: per sampled pull request, which commitments are in effect,
which in-scope added lines match a commitment's screen pattern, and whether a later commit reverts
the pull request. Also writes each pull request's diff for the full reading.

Usage: python screen.py <repos_dir> <sample_jsonl> <diffs_dir> <out_jsonl>

Patterns implement the "Screen" column of commitments.md. A hit is a pointer for the reader, never
a label.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

SRC = r"\.(tsx?|jsx?|mjs|cjs)$"
FRONTEND = r"^(plugins/(?![^/]*-(backend|node|common)\b)[^/]+/src/|packages/(core-components|core-app-api|core-plugin-api|app|app-defaults|frontend-[^/]+|theme)/src/)"
NODE_SIDE = r"^(plugins/[^/]*-(backend|node)[^/]*/|packages/(backend-[^/]+|cli[^/]*|[^/]*-node|repo-tools)/)"

COMMITMENTS = {
    "backstage_backstage": [
        ("B1", "docs/architecture-decisions/adr003-avoid-default-exports.md",
         r"^(packages|plugins)/[^/]+/src/.*" + SRC, r"\.(stories|config)\.", r"^\s*export\s+default\b"),
        ("B2", "docs/architecture-decisions/adr004-module-export-structure.md",
         r"^(packages|plugins)/[^/]+/src/.*" + SRC, None,
         r"^\s*export\s+(\*|\{[^}]*\}|type\s+\{[^}]*\})\s+from\s+['\"]"),
        ("B3", "docs/architecture-decisions/adr006-avoid-react-fc.md",
         r"^(packages|plugins)/.*\.tsx?$", None,
         r"React\.(FC|SFC|FunctionComponent)\b|:\s*(FC|SFC|FunctionComponent)\s*<|\bVFC<"),
        ("B4", "docs/architecture-decisions/adr007-use-msw-to-mock-service-requests.md",
         r"^(packages|plugins)/.*\.test\.(tsx?|jsx?)$", None,
         r"(global|globalThis|window)\.fetch\s*=|spyOn\(\s*(global|globalThis|window)\s*,\s*['\"]fetch['\"]|jest\.mock\(['\"](node-fetch|cross-fetch|axios)['\"]|fetch-mock"),
        ("B5", "docs/architecture-decisions/adr010-luxon-date-library.md",
         r"^(packages|plugins)/", None,
         r"from\s+['\"](moment|date-fns|dayjs)(/[^'\"]*)?['\"]|require\(['\"](moment|date-fns|dayjs)|\"(moment|date-fns|dayjs)\"\s*:"),
        ("B6", "docs/architecture-decisions/adr011-plugin-package-structure.md",
         r"^(plugins|packages)/[^/]+/package\.json$", None, r"^\s*\"name\"\s*:"),
        ("B7", "docs/architecture-decisions/adr012-use-luxon-locale-and-date-presets.md",
         FRONTEND, None, r"\.toFormat\("),
        ("B8", "docs/architecture-decisions/adr014-use-fetch.md",
         NODE_SIDE, None,
         r"from\s+['\"](node-fetch|axios|got|superagent|request|isomorphic-fetch)['\"]|require\(['\"](node-fetch|axios|got|superagent|request|isomorphic-fetch)['\"]\)|\"(node-fetch|axios|got|superagent|request|isomorphic-fetch)\"\s*:"),
        ("B9", "docs/architecture-decisions/adr014-use-fetch.md",
         FRONTEND + r".*" + SRC, r"\.test\.", r"(?<![.\w])fetch\("),
        ("B10", "docs/architecture-decisions/adr015-jsx-loader-structure.md",
         r"^packages/frontend-[^/]+/src/.*\.tsx?$", r"\.test\.",
         r"^\s*\w+\??\s*:\s*(JSX\.Element|React\.ReactElement|ReactElement|ComponentType|React\.ComponentType|\(\s*\)\s*=>\s*Promise<)"),
        ("B11", "docs/architecture-decisions/adr009-entity-references.md",
         FRONTEND, None, r"stringifyEntityRef\(|/catalog/:"),
    ],
    "mozilla_fxa": [
        ("F1", "docs/adr/0022-deprecate-hawk.md", r"^(packages|libs)/.*" + SRC, r"\.test\.|/test/",
         r"(?i)\bhawk\b"),
        ("F2", "docs/adr/0044-use-rest-over-gql-when-convenient.md", r"^packages/fxa-settings/src/", r"\.test\.",
         r"\bgql\s*`|\buse(Query|Mutation|LazyQuery)\s*\("),
        ("F3", "docs/adr/0043-react-functional-tests.md", r"^packages/functional-tests/", None,
         r"getByTestId\(|data-testid|\.locator\(\s*['\"`][.#\[]"),
        ("F4", "docs/adr/0019-use-workspace-dependencies.md", r"package\.json$", None,
         r"\"(fxa-[a-z0-9-]+|@fxa/[a-z0-9/-]+)\"\s*:\s*\"(?!workspace:)"),
        ("F5", "docs/adr/0032-l10n-i18n-improvements.md",
         r"^(packages/(fxa-settings|fxa-payments-server|fxa-react|fxa-auth-server)|libs)/", None,
         r"<FtlMsg\b[^>]*/>|\bgetString\(\s*['\"][^'\"]+['\"]\s*\)|en-US\.ftl"),
        ("F6", "docs/adr/0040-stripe-typings.md", r"^(packages|libs)/.*" + SRC, r"^libs/payments/stripe/|\.test\.",
         r"from\s+['\"]stripe['\"]|new\s+Stripe\("),
        ("F7", "docs/adr/0039-use-react-container-component-abstraction.md",
         r"^packages/fxa-settings/src/pages/(?!Settings)", r"\.test\.", r"\buse(Query|Mutation|Account|Session)\b|\bapolloClient\b|authClient\."),
        ("F8", "docs/adr/0051-account-authorization-table.md", r"^packages/fxa-auth-server/", None,
         r"lastAuthorizedTosAt|accountAuthorizations|prompt\s*[=:]\s*['\"]?none"),
        ("F9", "docs/adr/0048-refresh-tokens-and-account-level-authorization.md",
         r"^packages/(fxa-auth-server|fxa-settings)/", None, r"token-exchange|token_exchange|subject_token|refresh_token"),
        ("F10", "docs/adr/0005-minimize-password-entry.md", r"^packages/(fxa-settings|fxa-content-server|fxa-auth-server)/", None,
         r"(?i)password.*(required|prompt|needed)|requirePassword|keysRequired|wantsKeys"),
        ("F11", "docs/adr/0004-product-capabilities-for-subscription-services.md", r"^(packages|libs)/", None,
         r"(?i)capabilit"),
        ("F12", "docs/adr/0020-application-architecture.md", r"^(packages|libs)/[^/]+/package\.json$", None, r"^\s*\"name\"\s*:"),
        ("F13", "docs/adr/0015-use-css-variables-and-scss.md", r"^packages/fxa-settings/", None,
         r"from\s+['\"](styled-components|@emotion/[a-z-]+)['\"]"),
        ("F14", "docs/adr/0028-evaluate-playwright.md", r"^packages/fxa-content-server/tests/functional/", None, r"."),
    ],
    "Sylius_Sylius": [
        ("S1", "adr/2022_03_24_remove_flush_from_handlers.md", r"(Handler|MessageHandler)/.*\.php$|Handler\.php$",
         r"(^|/)(tests?|spec)/", r"->flush\("),
        ("S2", "adr/2022_03_18_raw_data_in_command_and_events.md", r"/(Command|Event)/.*\.php$", r"(^|/)(tests?|spec)/",
         r"(public|protected|private|readonly)[^$;]*\b[A-Z]\w*Interface\s+\$"),
        ("S3", "adr/2024_08_29_message_buses_unification.md", r"\.(php|xml|ya?ml)$", r"UPGRADE|CHANGELOG",
         r"sylius_default\.bus|sylius\.default_bus|sylius_event\.bus"),
        ("S4", "adr/2020_11_12_registration_of_handlers_in_message_buses.md", r"\.(php|xml|ya?ml)$", r"(^|/)(tests?|spec)/",
         r"messenger\.message_handler|AsMessageHandler"),
        ("S5", "adr/2024_10_03_services_naming_convention.md", r"Resources/config/.*\.(xml|php|ya?ml)$|config/services", None,
         r"<service\s+id=|->set\(|^\s*[A-Za-z\\\\]+:\s*$"),
        ("S6", "adr/2024_07_15_api_state_providers_structure.md", r"ApiBundle/.*StateProvider/.*\.php$", None, r"^\s*(final\s+)?(readonly\s+)?class\s"),
        ("S7", "adr/2024_07_16_api_query_extensions_directory_structure.md", r"ApiBundle/.*QueryExtension/.*\.php$", None, r"^\s*(final\s+)?(readonly\s+)?class\s"),
        ("S8", "adr/2024_07_16_state_processors_directory_structure.md", r"ApiBundle/.*StateProcessor/.*\.php$", None, r"^\s*(final\s+)?(readonly\s+)?class\s"),
        ("S9", "adr/2024_10_22_filters_structure_refactor.md", r"ApiBundle/", None, r"sylius_api\.[a-z_]*filter[a-z_.]*"),
        ("S10", "adr/2025_04_07_transition_from_phpspec_to_phpunit.md", r"(^|/)spec/.*\.php$|Spec\.php$", None, r"ObjectBehavior|function it_"),
        ("S11", "adr/2024_05_15_use_separate_base_form_types_for_admin_panel_instead_of_type_extensions.md",
         r"AdminBundle/.*\.php$", None, r"extends\s+AbstractTypeExtension"),
        ("S12", "adr/2024_11_28_languages_flags.md", r"\.(twig|php|ya?ml|js|scss)$", None, r"(?i)\bflag"),
        ("S13", "adr/2021_04_15_using_iri_as_api_resource_identifier_in_request_instead_of_code_id.md",
         r"ApiBundle/(Command|.*Denormalizer|.*Resources/config/api_resources)/", None, r"(?i)\b(code|id)\b"),
        ("S14", "adr/2020_03_03_api_product_option_values.md", r"ApiBundle/.*(serialization|api_resources|Serializer|Normalizer)", None, r"(?i)optionValue|translations"),
        ("S15", "adr/2021_02_05_unified_api_prefix.md", r"ApiBundle/.*(routing|api_resources|Resources/config)", None, r"uriTemplate|path=|route_prefix|/api/"),
        ("S16", "adr/2020_05_13_handling_non_crud_operations_in_api.md", r"ApiBundle/.*(api_resources|Resources/config)", None, r"(?i)operation|controller"),
    ],
}

DIFF_FILE = re.compile(r"^diff --git a/(.+?) b/(.+)$")


def git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, encoding="utf-8", errors="replace"
    ).stdout


def added_lines_by_file(diff: str):
    current, out, removed = None, {}, set()
    for line in diff.splitlines():
        match = DIFF_FILE.match(line)
        if match:
            current = match.group(2)
            out.setdefault(current, {"new": False, "added": []})
            continue
        if current is None:
            continue
        if line.startswith("new file mode"):
            out[current]["new"] = True
        elif line.startswith("+") and not line.startswith("+++"):
            out[current]["added"].append(line[1:])
        elif line.startswith("-") and not line.startswith("---"):
            removed.add(line[1:].strip())
    return out, removed


def main() -> None:
    repos_dir, sample_path, diffs_dir, out_path = (Path(arg) for arg in sys.argv[1:5])
    diffs_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for line in sample_path.read_text(encoding="utf-8").splitlines():
        pr = json.loads(line)
        repo = repos_dir / pr["repo"]
        diff = git(repo, "diff", "--no-color", "-M", pr["first_parent"], pr["sha"])
        (diffs_dir / f"{pr['repo']}-{pr['pr']}.diff").write_text(diff, encoding="utf-8")
        files, removed = added_lines_by_file(diff)
        in_effect, hits, touched = [], [], set()
        for cid, adr, scope, exclude, pattern in COMMITMENTS[pr["repo"]]:
            present = subprocess.run(
                ["git", "-C", str(repo), "cat-file", "-e", f"{pr['first_parent']}:{adr}"], capture_output=True
            ).returncode == 0
            if not present:
                continue
            in_effect.append(cid)
            scope_re, exclude_re, pattern_re = re.compile(scope), re.compile(exclude) if exclude else None, re.compile(pattern)
            for path, info in files.items():
                if not scope_re.search(path) or (exclude_re and exclude_re.search(path)):
                    continue
                touched.add(cid)
                for text in info["added"]:
                    if pattern_re.search(text):
                        # Protocol (b): a line the same diff also removes was moved, not introduced.
                        hits.append({"commitment": cid, "file": path, "new_file": info["new"],
                                     "moved": text.strip() in removed, "line": text.strip()[:200]})
        # A revert later in the default branch names the pull request or quotes its title.
        reverts = git(repo, "log", "--first-parent", "--format=%h %s", f"{pr['sha']}..HEAD", "--grep=^Revert", "-i").splitlines()
        reverted = [r for r in reverts if f"#{pr['pr']}" in r or pr["title"][:40].lower() in r.lower()]
        added_total = sum(len(info["added"]) for info in files.values())
        rows.append({
            "repo": pr["repo"], "pr": pr["pr"], "sha": pr["sha"], "title": pr["title"], "date": pr["date"],
            "files": len(files), "added_lines": added_total, "in_effect": in_effect,
            "in_scope": sorted(touched), "hits": hits[:60], "hit_count": len(hits), "reverted_by": reverted,
        })
        print(f"{pr['repo']} #{pr['pr']}: {len(files)} files, +{added_total}, {len(hits)} hits, scope {sorted(touched)}")
    out_path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


if __name__ == "__main__":
    main()
