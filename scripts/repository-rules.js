const PUBLIC_DEMO_URL = 'https://spadacenta.com/trafficmap';
const PUBLIC_DEMO_LINK = `[spadacenta.com/trafficmap](${PUBLIC_DEMO_URL})`;

export function findInstallationSpecificReferences(files) {
  const failures = [];

  for (const [relativePath, content] of files) {
    const normalizedPath = relativePath.replaceAll('\\', '/');
    const domainContent = normalizedPath === 'README.md'
      ? content.replaceAll(PUBLIC_DEMO_LINK, '').replaceAll(PUBLIC_DEMO_URL, '')
      : content;

    if (/spadacenta/i.test(domainContent)) {
      failures.push(`installation-specific domain found in ${normalizedPath}`);
    }
    if (/\/etc\/letsencrypt\/live\//i.test(content)) {
      failures.push(`installation-specific TLS path found in ${normalizedPath}`);
    }
  }

  return failures;
}
