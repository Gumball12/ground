import { resolveApiUrl } from '../domain/runtime-paths.js';

export const plantUmlApiClient = {
  async renderSvg(source) {
    const response = await fetch(resolveApiUrl('/plantuml/render'), {
      body: JSON.stringify({ source }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok || typeof data.svg !== 'string') {
      throw new Error(data?.error || 'Failed to render PlantUML');
    }

    return data.svg;
  },
};
