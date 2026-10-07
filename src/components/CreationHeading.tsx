import React from 'react';
import '../styles/creation.css';

/** 创作页共用标题区域，固定行槽保证不同文案下输入框仍然对齐。eyebrow 可留空（不显示英文标签）。 */
export const CreationHeading: React.FC<{ eyebrow?: string; title: string; description: string }> = ({ eyebrow, title, description }) => (
  <section className="celano-creation-heading">
    {eyebrow ? <p className="celano-creation-eyebrow">{eyebrow}</p> : null}
    <h1>{title}</h1>
    <p className="celano-creation-description">{description}</p>
  </section>
);
