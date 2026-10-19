/* Shared, text-safe evidence presentation for details, queries and canvas markers. */
(function () {
  'use strict';
  const E = globalThis.RelationshipEvidence;
  const el = (tag,cls,text) => { const node = document.createElement(tag); node.className = cls || ''; if (text != null) node.textContent = text; return node; };
  function badge(proof) {
    const node = el('span','relationship-origin',E.text(proof));
    node.dataset.origin = proof.origin; return node;
  }
  function sentence(data,from,relation) {
    const people = new Map(data.people.map(p => [p.id,p]));
    return (people.get(relation.to ?? relation.personId)?.name || '已移除成員') + '是' + (people.get(from)?.name || '已移除成員') + '的' + (E.types[relation.type] || '關係成員') + (relation.kind ? '（' + relation.kind + '）' : '');
  }
  function render(container,data,items,{ onEdit = id => globalThis.editFamilyMember?.(id) } = {}) {
    container.replaceChildren();
    for (const { from,relation,evidence } of items) {
      const section = el('section','evidence-record');
      section.append(el('h3','',sentence(data,from,relation)),badge(evidence));
      const steps = evidence.origin === 'direct' ? [{ from,to:relation.to ?? relation.personId,type:relation.type,records:evidence.records }] : evidence.premises;
      if (!steps.length) section.append(el('p','evidence-missing','尚無完整的原始記錄可供核對。'));
      for (const step of steps) {
        const row = el('div','evidence-premise');
        if (evidence.origin === 'inferred') {
          row.append(el('p','evidence-premise__title',sentence(data,step.from,step)),badge(E.describe(data,step.from,{...step,personId:step.to})));
        }
        if (!step.records.length) row.append(el('p','evidence-missing','找不到此段原始記錄。'));
        for (const record of step.records) {
          const owner = data.people.find(p => p.id === record.ownerId);
          const details = el('div','evidence-source');
          details.append(el('p','','記錄於：' + (owner?.name || record.ownerId)));
          details.append(el('p','','來源：' + (record.relation.source || '未填')));
          if (record.relation.note) details.append(el('p','','說明：' + record.relation.note));
          if (owner && onEdit) {
            const edit = el('button','plain-button','編輯' + owner.name + '的原始記錄'); edit.type = 'button';
            edit.addEventListener('click',() => onEdit(owner.id)); details.append(edit);
          }
          row.append(details);
        }
        section.append(row);
      }
      container.append(section);
    }
  }
  let dialog,body,resolveItems;
  function open(data,items,{ opener = document.activeElement, originFilter = null } = {}) {
    if (originFilter) items = items.filter(item => item.evidence.origin === originFilter);
    if (!dialog) {
      dialog = el('dialog','relationship-proof-dialog'); dialog.id = 'relationship-proof-dialog';
      dialog.setAttribute('aria-labelledby','relationship-proof-title');
      const header = el('header','dialog-header'),title = el('h2','','關係依據'); title.id = 'relationship-proof-title';
      const close = el('button','details-icon','×'); close.type = 'button'; close.setAttribute('aria-label','關閉關係依據');
      close.addEventListener('click',() => dialog.close()); header.append(title,close);
      body = el('div','relationship-proof-body'); dialog.append(header,body); document.body.append(dialog);
      dialog.addEventListener('click',event => { if (event.target === dialog) dialog.close(); });
      dialog.addEventListener('close',() => { if (!dialog.open) resolveItems = null; });
      globalThis.addEventListener('familyappchange',() => {
        if (!dialog.open || !resolveItems) return;
        const latest = globalThis.FamilyApp.graph();
        const refreshed = resolveItems(latest);
        render(body,latest,refreshed,{ onEdit:edit });
        if (!refreshed.length) body.append(el('p','evidence-missing','目前已無可顯示的關係依據。'));
      });
    }
    function edit(id) { dialog.close(); globalThis.editFamilyMember?.(id); }
    // Re-resolve from IDs/types after edits instead of retaining stale snapshots.
    resolveItems = latest => {
      const resolver = E.create(latest);
      const refreshed = items.flatMap(item => resolver.between(item.from,item.relation.to ?? item.relation.personId,[item.relation.type]))
        .filter(item => !originFilter || item.evidence.origin === originFilter);
      return refreshed.filter((item,i) => refreshed.findIndex(other => E.stable(other) === E.stable(item)) === i);
    };
    render(body,data,items,{ onEdit:edit });
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('button').focus();
    dialog.onclose = () => {
      if (dialog.open) return;
      const replacement = opener?.dataset.evidenceKey && [...document.querySelectorAll('.relationship-entry__badge--inferred,.canvas-evidence')].find(node => node.dataset.evidenceKey === opener.dataset.evidenceKey && node.getClientRects().length);
      (opener?.isConnected ? opener : replacement || document.querySelector('#relationship-details:not([hidden]) .details-close'))?.focus({preventScroll:true});
    };
  }
  function appendLegend(container) {
    const list = el('div','relationship-source-legend');
    list.append(el('strong','','關係來源'));
    for (const origin of ['直接記錄','推導']) list.append(el('span','relationship-origin',origin));
    list.append(el('p','','來源與說明可選填，從關係詳情查看原始記錄。')); container.append(list);
  }
  globalThis.RelationshipEvidenceView = { badge,sentence,render,open,appendLegend };
})();
