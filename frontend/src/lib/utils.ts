import { createCn } from "cn/config";

/**
 * Class merging aware of the custom type scale (spec §8). Without this,
 * `text-kpi` would be treated as a text color and dropped when merged with
 * `text-foreground`.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "kpi", "h1", "h2", "h3", "body", "small", "caption", "overline"] }],
    },
  },
});
