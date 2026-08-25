'use strict';

const form = document.querySelector('#project-form');
const input = document.querySelector('#project-name');
const list = document.querySelector('#projects');
const emptyState = document.querySelector('#empty-state');

function render(items) {
    list.replaceChildren(...items.map(item => {
        const element = document.createElement('li');
        element.textContent = item.name;
        return element;
    }));
    emptyState.hidden = items.length > 0;
}

async function load() {
    const response = await fetch('/api/items');
    render(await response.json());
}

form.addEventListener('submit', async event => {
    event.preventDefault();
    const response = await fetch('/api/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: input.value }),
    });
    if (!response.ok) {
        throw new Error(`Create failed with ${response.status}`);
    }
    input.value = '';
    await load();
});

void load();
