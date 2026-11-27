use crate::models::DirectoryContact;
use chrono::Local;
use reqwest::{Client, Method};
use std::collections::{HashMap, HashSet};
use std::time::Duration;

const PROPFIND_DISCOVERY_BODY: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <d:current-user-principal/>
    <c:addressbook-home-set/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>"#;

const PROPFIND_HOME_BODY: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <c:addressbook-home-set/>
  </d:prop>
</d:propfind>"#;

const PROPFIND_COLLECTIONS_BODY: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <d:resourcetype/>
    <d:displayname/>
  </d:prop>
</d:propfind>"#;

const REPORT_QUERY_BODY: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<c:addressbook-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <d:getetag/>
    <c:address-data/>
  </d:prop>
</c:addressbook-query>"#;

pub async fn sync_carddav_contacts_async(
    server_url: &str,
    username: &str,
    password: &str,
) -> Result<Vec<DirectoryContact>, String> {
    let base_url = server_url.trim().trim_end_matches('/').to_string();
    if !(base_url.starts_with("https://") || base_url.starts_with("http://")) {
        return Err("CardDAV 服务器地址必须以 https:// 或 http:// 开头".into());
    }
    if username.trim().is_empty() || password.trim().is_empty() {
        return Err("请填写有效的 CardDAV 账号与授权码/密码".into());
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("LinenMail/1.0 CardDAV")
        .build()
        .map_err(|e| format!("初始化 CardDAV 网络客户端失败: {}", e))?;

    // 1. Discover principal & addressbook-home-set
    let mut home_url: Option<String> = None;
    let mut principal_url: Option<String> = None;
    let mut direct_is_addressbook = false;

    let origin = extract_origin(&base_url);
    let mut probe_urls = vec![base_url.clone()];
    if !origin.is_empty() && !base_url.contains("/.well-known/carddav") {
        probe_urls.push(format!("{}/.well-known/carddav", origin));
    }

    let mut auth_failed = false;
    let mut last_err = String::new();

    for probe in &probe_urls {
        match dav_request(
            &client,
            "PROPFIND",
            probe,
            username,
            password,
            Some("0"),
            PROPFIND_DISCOVERY_BODY,
        )
        .await
        {
            Ok((status, body)) => {
                if status == 401 || status == 403 {
                    auth_failed = true;
                    last_err = format!("CardDAV 认证失败（HTTP {}），请检查邮箱账号或授权码/客户端专用密码", status);
                    continue;
                }
                if (200..300).contains(&status) {
                    if let Some(h) = extract_nested_href(&body, "addressbook-home-set") {
                        home_url = Some(resolve_dav_url(probe, &h));
                    }
                    if let Some(p) = extract_nested_href(&body, "current-user-principal") {
                        principal_url = Some(resolve_dav_url(probe, &p));
                    }
                    if body.to_lowercase().contains("addressbook")
                        && extract_tag_inner(&body, "resourcetype")
                            .map(|rt| rt.to_lowercase().contains("addressbook"))
                            .unwrap_or(false)
                    {
                        direct_is_addressbook = true;
                    }
                    if home_url.is_some() || principal_url.is_some() || direct_is_addressbook {
                        break;
                    }
                } else {
                    last_err = format!("服务器返回 HTTP {}", status);
                }
            }
            Err(e) => {
                last_err = e;
            }
        }
    }

    if auth_failed && home_url.is_none() && principal_url.is_none() && !direct_is_addressbook {
        return Err(last_err);
    }

    // 2. If only principal found, query addressbook-home-set on principal
    if home_url.is_none() {
        if let Some(ref p_url) = principal_url {
            if let Ok((status, body)) = dav_request(
                &client,
                "PROPFIND",
                p_url,
                username,
                password,
                Some("0"),
                PROPFIND_HOME_BODY,
            )
            .await
            {
                if (200..300).contains(&status) {
                    if let Some(h) = extract_nested_href(&body, "addressbook-home-set") {
                        home_url = Some(resolve_dav_url(p_url, &h));
                    }
                }
            }
        }
    }

    // 3. List addressbook collections under home_url (or base_url)
    let mut addressbook_urls: Vec<String> = Vec::new();
    let mut visited_urls: HashSet<String> = HashSet::new();

    if direct_is_addressbook {
        visited_urls.insert(base_url.clone());
        addressbook_urls.push(base_url.clone());
    }

    let list_target = home_url.clone().unwrap_or_else(|| base_url.clone());
    if let Ok((status, body)) = dav_request(
        &client,
        "PROPFIND",
        &list_target,
        username,
        password,
        Some("1"),
        PROPFIND_COLLECTIONS_BODY,
    )
    .await
    {
        if status == 401 || status == 403 {
            return Err(format!(
                "CardDAV 认证失败（HTTP {}），请确认已在企业邮箱开启 CardDAV 并使用客户端专用密码",
                status
            ));
        }
        if (200..300).contains(&status) {
            for resp_block in extract_all_tag_inners(&body, "response") {
                let is_ab = extract_tag_inner(&resp_block, "resourcetype")
                    .map(|rt| rt.to_lowercase().contains("addressbook"))
                    .unwrap_or(false);
                if is_ab {
                    if let Some(href) = extract_tag_inner(&resp_block, "href") {
                        let resolved = resolve_dav_url(&list_target, href.trim());
                        if visited_urls.insert(resolved.clone()) {
                            addressbook_urls.push(resolved);
                        }
                    }
                }
            }
        }
    }

    if addressbook_urls.is_empty() {
        addressbook_urls.push(list_target);
    }

    // 4. Query each addressbook via REPORT addressbook-query (with PROPFIND+GET fallback)
    let mut all_contacts: Vec<DirectoryContact> = Vec::new();

    for ab_url in &addressbook_urls {
        let mut found_in_ab = false;

        if let Ok((status, body)) = dav_request(
            &client,
            "REPORT",
            ab_url,
            username,
            password,
            Some("1"),
            REPORT_QUERY_BODY,
        )
        .await
        {
            if (200..300).contains(&status) {
                let vcards = extract_all_tag_inners(&body, "address-data");
                for raw_v in vcards {
                    let unescaped = unescape_xml(&raw_v);
                    let parsed = parse_vcards(&unescaped, "carddav");
                    if !parsed.is_empty() {
                        found_in_ab = true;
                        all_contacts.extend(parsed);
                    }
                }
            }
        }

        // Fallback: PROPFIND Depth:1 for .vcf hrefs + individual GET
        if !found_in_ab {
            if let Ok((status, body)) = dav_request(
                &client,
                "PROPFIND",
                ab_url,
                username,
                password,
                Some("1"),
                PROPFIND_COLLECTIONS_BODY,
            )
            .await
            {
                if (200..300).contains(&status) {
                    let mut vcf_urls = Vec::new();
                    for resp_block in extract_all_tag_inners(&body, "response") {
                        if let Some(href) = extract_tag_inner(&resp_block, "href") {
                            let trimmed = href.trim();
                            if trimmed.to_lowercase().ends_with(".vcf") {
                                vcf_urls.push(resolve_dav_url(ab_url, trimmed));
                            }
                        }
                    }
                    for vcf_url in vcf_urls.into_iter().take(400) {
                        if let Ok(resp) = client
                            .get(&vcf_url)
                            .basic_auth(username, Some(password))
                            .send()
                            .await
                        {
                            if resp.status().is_success() {
                                if let Ok(text) = resp.text().await {
                                    all_contacts.extend(parse_vcards(&text, "carddav"));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let deduped = dedupe_contacts(all_contacts);
    if deduped.is_empty() && !last_err.is_empty() {
        return Err(format!("未能从 CardDAV 拉取到联系人（{}）", last_err));
    }
    Ok(deduped)
}

async fn dav_request(
    client: &Client,
    method_name: &str,
    url: &str,
    username: &str,
    password: &str,
    depth: Option<&str>,
    body: &str,
) -> Result<(u16, String), String> {
    let method = Method::from_bytes(method_name.as_bytes())
        .map_err(|e| format!("无效 HTTP 方法 {}: {}", method_name, e))?;
    let mut req = client
        .request(method, url)
        .basic_auth(username, Some(password))
        .header("Content-Type", "application/xml; charset=utf-8")
        .header("Accept", "application/xml, text/xml, */*");
    if let Some(d) = depth {
        req = req.header("Depth", d);
    }
    let resp = req
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("连接 CardDAV 服务器失败: {}", e))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.unwrap_or_default();
    Ok((status, text))
}

fn extract_origin(url: &str) -> String {
    if let Some(scheme_pos) = url.find("://") {
        let rest = &url[scheme_pos + 3..];
        let host_end = rest.find('/').unwrap_or(rest.len());
        return format!("{}{}", &url[..scheme_pos + 3], &rest[..host_end]);
    }
    String::new()
}

fn resolve_dav_url(base: &str, href: &str) -> String {
    let h = href.trim();
    if h.starts_with("http://") || h.starts_with("https://") {
        return h.to_string();
    }
    if h.starts_with('/') {
        let origin = extract_origin(base);
        if !origin.is_empty() {
            return format!("{}{}", origin, h);
        }
    }
    let base_trimmed = base.trim_end_matches('/');
    format!("{}/{}", base_trimmed, h.trim_start_matches('/'))
}

fn extract_nested_href(xml: &str, container_local_name: &str) -> Option<String> {
    let inner = extract_tag_inner(xml, container_local_name)?;
    extract_tag_inner(&inner, "href").map(|s| unescape_xml(s.trim()))
}

fn extract_tag_inner(xml: &str, local_name: &str) -> Option<String> {
    extract_all_tag_inners(xml, local_name).into_iter().next()
}

/// Zero-dependency namespace-agnostic XML tag inner content extractor.
fn extract_all_tag_inners(xml: &str, local_name: &str) -> Vec<String> {
    let mut results = Vec::new();
    let target = local_name.to_lowercase();
    let bytes = xml.as_bytes();
    let len = bytes.len();
    let mut pos = 0usize;

    while pos < len {
        let Some(lt_rel) = xml[pos..].find('<') else {
            break;
        };
        let lt = pos + lt_rel;
        if lt + 1 >= len {
            break;
        }
        // Skip closing tags, comments, declarations
        let next_b = bytes[lt + 1];
        if next_b == b'/' || next_b == b'!' || next_b == b'?' {
            pos = lt + 1;
            continue;
        }
        let Some(gt_rel) = xml[lt..].find('>') else {
            break;
        };
        let gt = lt + gt_rel;
        let open_tag = &xml[lt + 1..gt];
        if open_tag.trim_end().ends_with('/') {
            pos = gt + 1;
            continue;
        }

        // Extract tag name (first token before whitespace)
        let tag_full = open_tag.split_whitespace().next().unwrap_or("");
        let tag_local = tag_full.rsplit(':').next().unwrap_or(tag_full).to_lowercase();

        if tag_local != target {
            pos = gt + 1;
            continue;
        }

        // Find matching closing tag </...:local_name> or </local_name>
        let content_start = gt + 1;
        let mut search_pos = content_start;
        let mut found_end = None;

        while search_pos < len {
            let Some(clt_rel) = xml[search_pos..].find("</") else {
                break;
            };
            let clt = search_pos + clt_rel;
            let Some(cgt_rel) = xml[clt..].find('>') else {
                break;
            };
            let cgt = clt + cgt_rel;
            let close_name = xml[clt + 2..cgt].trim();
            let close_local = close_name
                .rsplit(':')
                .next()
                .unwrap_or(close_name)
                .to_lowercase();
            if close_local == target {
                found_end = Some((clt, cgt + 1));
                break;
            }
            search_pos = cgt + 1;
        }

        if let Some((content_end, next_pos)) = found_end {
            let mut inner = xml[content_start..content_end].to_string();
            let trimmed = inner.trim();
            if trimmed.starts_with("<![CDATA[") && trimmed.ends_with("]]>") {
                inner = trimmed[9..trimmed.len() - 3].to_string();
            }
            results.push(inner);
            pos = next_pos;
        } else {
            pos = gt + 1;
        }
    }

    results
}

fn unescape_xml(raw: &str) -> String {
    raw.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#13;", "\r")
        .replace("&#10;", "\n")
        .replace("&#xD;", "\r")
        .replace("&#xA;", "\n")
        .replace("&amp;", "&")
}

/// Parses one or more RFC 6350 / vCard 2.1 / 3.0 / 4.0 blocks (including Foxmail/WeCom QUOTED-PRINTABLE).
pub fn parse_vcards(raw: &str, source: &str) -> Vec<DirectoryContact> {
    // 1. Unfold RFC 6350 folded lines + QUOTED-PRINTABLE soft breaks
    let normalized = raw.replace("\r\n", "\n").replace('\r', "\n");
    let mut unfolded: Vec<String> = Vec::new();
    let mut prev_qp_soft_break = false;

    for line in normalized.lines() {
        if prev_qp_soft_break {
            if let Some(last) = unfolded.last_mut() {
                if last.ends_with('=') {
                    last.pop();
                }
                last.push_str(line);
                prev_qp_soft_break = last.ends_with('=') && last.to_uppercase().contains("QUOTED-PRINTABLE");
                continue;
            }
        }
        if (line.starts_with(' ') || line.starts_with('\t')) && !unfolded.is_empty() {
            if let Some(last) = unfolded.last_mut() {
                last.push_str(&line[1..]);
                prev_qp_soft_break = last.ends_with('=') && last.to_uppercase().contains("QUOTED-PRINTABLE");
                continue;
            }
        }
        let s = line.to_string();
        prev_qp_soft_break = s.ends_with('=') && s.to_uppercase().contains("QUOTED-PRINTABLE");
        unfolded.push(s);
    }

    let now_str = Local::now().format("%Y-%m-%d %H:%M").to_string();
    let mut contacts = Vec::new();
    let mut in_card = false;
    let mut fn_name = String::new();
    let mut n_name = String::new();
    let mut org = String::new();
    let mut title = String::new();
    let mut emails: Vec<String> = Vec::new();

    let flush_card = |contacts: &mut Vec<DirectoryContact>,
                      fn_name: &mut String,
                      n_name: &mut String,
                      org: &mut String,
                      title: &mut String,
                      emails: &mut Vec<String>| {
        let best_name = if !fn_name.trim().is_empty() {
            fn_name.trim().to_string()
        } else {
            n_name.trim().to_string()
        };
        let dept = org
            .split(';')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" / ");
        let role_str = title.trim().to_string();

        for email in emails.drain(..) {
            let clean_email = email.trim().to_lowercase();
            if !clean_email.contains('@') {
                continue;
            }
            let display_name = if !best_name.is_empty() {
                best_name.clone()
            } else {
                clean_email.split('@').next().unwrap_or(&clean_email).to_string()
            };
            contacts.push(DirectoryContact {
                email: clean_email,
                name: display_name,
                role: role_str.clone(),
                department: dept.clone(),
                source: source.to_string(),
                updated_at: now_str.clone(),
            });
        }
        fn_name.clear();
        n_name.clear();
        org.clear();
        title.clear();
    };

    for line in unfolded {
        let trimmed = line.trim();
        let upper = trimmed.to_uppercase();
        if upper == "BEGIN:VCARD" {
            in_card = true;
            fn_name.clear();
            n_name.clear();
            org.clear();
            title.clear();
            emails.clear();
            continue;
        }
        if upper == "END:VCARD" {
            if in_card {
                flush_card(
                    &mut contacts,
                    &mut fn_name,
                    &mut n_name,
                    &mut org,
                    &mut title,
                    &mut emails,
                );
            }
            in_card = false;
            continue;
        }
        if !in_card {
            continue;
        }
        let Some((key_part, raw_val)) = trimmed.split_once(':') else {
            continue;
        };
        let key_upper = key_part.to_uppercase();
        // Strip optional item group prefix like "item1.EMAIL"
        let base_key_full = key_upper.split(';').next().unwrap_or("");
        let base_key = base_key_full.rsplit('.').next().unwrap_or(base_key_full);
        let is_qp = key_upper.contains("QUOTED-PRINTABLE");

        let val = if is_qp {
            decode_quoted_printable(raw_val)
        } else {
            unescape_vcard_value(raw_val)
        };

        match base_key {
            "FN" => {
                if !val.trim().is_empty() {
                    fn_name = val.trim().to_string();
                }
            }
            "N" => {
                // Format: Family;Given;Additional;Prefix;Suffix
                let parts: Vec<&str> = val.split(';').map(|s| s.trim()).collect();
                let family = parts.first().copied().unwrap_or("");
                let given = parts.get(1).copied().unwrap_or("");
                let combined = if is_cjk_str(family) || is_cjk_str(given) {
                    format!("{}{}", family, given)
                } else {
                    format!("{} {}", given, family).trim().to_string()
                };
                if !combined.trim().is_empty() {
                    n_name = combined;
                }
            }
            "ORG" => {
                if !val.trim().is_empty() {
                    org = val.trim().to_string();
                }
            }
            "TITLE" => {
                if !val.trim().is_empty() {
                    title = val.trim().to_string();
                }
            }
            "EMAIL" => {
                let cleaned = val.trim().trim_start_matches("mailto:").trim();
                if cleaned.contains('@') {
                    emails.push(cleaned.to_string());
                }
            }
            _ => {}
        }
    }

    dedupe_contacts(contacts)
}

/// Parses CSV contact exports (Foxmail, WeCom/腾讯企业邮, Outlook, QQ Mail).
pub fn parse_csv_contacts(raw: &str, source: &str) -> Vec<DirectoryContact> {
    let cleaned = raw.trim_start_matches('\u{feff}');
    let normalized = cleaned.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines = normalized.lines().filter(|l| !l.trim().is_empty());

    let Some(header_line) = lines.next() else {
        return vec![];
    };
    let headers: Vec<String> = parse_csv_row(header_line)
        .into_iter()
        .map(|h| h.trim().to_lowercase())
        .collect();

    let find_col = |needles: &[&str]| -> Option<usize> {
        headers.iter().position(|h| needles.iter().any(|n| h.contains(n)))
    };

    let email_col = find_col(&["电子邮件", "邮箱", "e-mail", "email", "mail"]);
    let name_col = find_col(&["姓名", "名字", "显示名", "名称", "full name", "display name", "name"]);
    let dept_col = find_col(&["部门", "组织", "公司", "department", "company", "org"]);
    let role_col = find_col(&["职位", "职务", "职称", "title", "role", "position"]);

    let now_str = Local::now().format("%Y-%m-%d %H:%M").to_string();
    let mut contacts = Vec::new();

    for line in lines {
        let cols = parse_csv_row(line);
        if cols.is_empty() {
            continue;
        }

        let email = email_col
            .and_then(|idx| cols.get(idx))
            .map(|s| s.trim().to_lowercase())
            .filter(|s| s.contains('@'))
            .or_else(|| {
                // Fallback: scan any column containing '@'
                cols.iter()
                    .find(|c| c.contains('@') && !c.contains(' '))
                    .map(|s| s.trim().to_lowercase())
            });

        let Some(email_addr) = email else {
            continue;
        };

        let name = name_col
            .and_then(|idx| cols.get(idx))
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| email_addr.split('@').next().unwrap_or(&email_addr).to_string());

        let department = dept_col
            .and_then(|idx| cols.get(idx))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        let role = role_col
            .and_then(|idx| cols.get(idx))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        contacts.push(DirectoryContact {
            email: email_addr,
            name,
            role,
            department,
            source: source.to_string(),
            updated_at: now_str.clone(),
        });
    }

    dedupe_contacts(contacts)
}

fn parse_csv_row(line: &str) -> Vec<String> {
    let mut cols = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();

    while let Some(ch) = chars.next() {
        if in_quotes {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    cur.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                cur.push(ch);
            }
        } else if ch == '"' {
            in_quotes = true;
        } else if ch == ',' || ch == '\t' {
            cols.push(cur.trim().to_string());
            cur.clear();
        } else {
            cur.push(ch);
        }
    }
    cols.push(cur.trim().to_string());
    cols
}

fn decode_quoted_printable(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'=' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn unescape_vcard_value(val: &str) -> String {
    val.replace("\\n", " ")
        .replace("\\N", " ")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
}

fn is_cjk_str(s: &str) -> bool {
    s.chars()
        .any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))
}

fn dedupe_contacts(list: Vec<DirectoryContact>) -> Vec<DirectoryContact> {
    let mut map: HashMap<String, DirectoryContact> = HashMap::new();
    for item in list {
        let key = item.email.trim().to_lowercase();
        if key.is_empty() || !key.contains('@') {
            continue;
        }
        match map.get_mut(&key) {
            Some(existing) => {
                let local_part = key.split('@').next().unwrap_or("");
                if (existing.name.is_empty() || existing.name.eq_ignore_ascii_case(local_part))
                    && !item.name.is_empty()
                {
                    existing.name = item.name;
                }
                if existing.department.is_empty() && !item.department.is_empty() {
                    existing.department = item.department;
                }
                if existing.role.is_empty() && !item.role.is_empty() {
                    existing.role = item.role;
                }
            }
            None => {
                map.insert(key, item);
            }
        }
    }
    let mut out: Vec<DirectoryContact> = map.into_values().collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}
