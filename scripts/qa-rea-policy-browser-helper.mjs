// Called from ego-browser's existing TaskSpace 3. Uses only observed DOM fields.
export async function fillObserved(page, values) {
  const completed = [];
  for (const [label, value] of Object.entries(values)) {
    const fields = await page.evaluate(() => [...document.querySelectorAll('.policy-editor label')].map(label => {
      const element = label.querySelector('input,textarea,select'); if (!element) return null;
      const title = [...label.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim();
      const path = []; let node = element;
      while (node && !node.classList.contains('policy-editor')) {
        path.unshift(node.tagName.toLowerCase() + ':nth-child(' + ([...node.parentElement.children].indexOf(node) + 1) + ')'); node = node.parentElement;
      }
      return { label: title, selector: '.policy-editor > ' + path.join(' > '), tag: element.tagName, type: element.type };
    }).filter(Boolean));
    const found = fields.filter(field => field.label === label);
    if (found.length !== 1) throw new Error('Expected exactly one observed field: ' + label + '; found=' + found.length);
    const field = found[0], selector = 'loc=css:' + field.selector;
    if (field.tag === 'SELECT') await page.selectOption(selector, String(value)); else await page.fill(selector, String(value));
    completed.push({ label, value });
  }
  return completed;
}
