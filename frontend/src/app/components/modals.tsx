import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ChevronDown, Crown, X } from 'lucide-react';
import { formatMetricValue } from '../../services/report/reportCatalog';
import { DETAIL_COLUMN_STORAGE_KEY, detailColumnMinWidthSum, detailColumns, mockEmployees } from '../constants';
import type { AppSettings, DetailColumnKey, DetailContext, DetailSort } from '../types';
import { TooltipButton, useOutsideClose } from './common';
import { bitrixEntityLabels, openBitrixEntity, openBitrixUser } from '../utils/bitrixNavigation';
import { normalizeDetailColumnWidths, resizeDetailColumnWidths, sumDetailColumnWidths } from '../utils/detailColumns';
import { buildMockDetailRows, compareDetailValues } from '../utils/detailRows';
import { loadDetailColumnWidths } from '../storage';

export function SaveViewModal({
  value,
  onValueChange,
  onClose,
  onSave,
  title = 'РЎРѕС…СЂР°РЅРёС‚СЊ РѕС‚РѕР±СЂР°Р¶РµРЅРёРµ',
}: {
  value: string;
  onValueChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
  title?: string;
}) {
  const panelRef = useOutsideClose<HTMLDivElement>(true, onClose);

  return (
    <div className="modal-layer" role="presentation">
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-view-title"
        ref={panelRef}
      >
        <div className="modal-head">
          <p id="save-view-title">{title}</p>
          <button className="icon-button" type="button" aria-label="Р—Р°РєСЂС‹С‚СЊ РѕРєРЅРѕ" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="field-label">
          <span>РќР°Р·РІР°РЅРёРµ</span>
          <input
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder="РќР°РїСЂРёРјРµСЂ, РѕС‚С‡РµС‚ РїСЂРѕРґР°Р¶"
            autoFocus
          />
        </label>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            РћС‚РјРµРЅР°
          </button>
          <button className="primary-button" type="button" onClick={onSave}>
            РЎРѕС…СЂР°РЅРёС‚СЊ
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmDeleteViewModal({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const panelRef = useOutsideClose<HTMLDivElement>(true, onCancel);

  return (
    <div className="modal-layer" role="presentation">
      <div className="modal-panel compact-modal-panel" role="dialog" aria-modal="true" ref={panelRef}>
        <div className="modal-head">
          <p>РЈРґР°Р»РёС‚СЊ РѕС‚РѕР±СЂР°Р¶РµРЅРёРµ</p>
          <button className="icon-button" type="button" aria-label="Р—Р°РєСЂС‹С‚СЊ РѕРєРЅРѕ" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <p className="modal-text">РўРѕС‡РЅРѕ СѓРґР°Р»РёС‚СЊ РѕС‚РѕР±СЂР°Р¶РµРЅРёРµ РѕС‚С‡РµС‚Р°?</p>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            РћС‚РјРµРЅР°
          </button>
          <button className="danger-button" type="button" onClick={onConfirm}>
            РЈРґР°Р»РёС‚СЊ
          </button>
        </div>
      </div>
    </div>
  );
}

export function FreeSaveLimitModal({
  onClose,
  onOpenPro,
}: {
  onClose: () => void;
  onOpenPro: () => void;
}) {
  const panelRef = useOutsideClose<HTMLDivElement>(true, onClose);

  return (
    <div className="modal-layer" role="presentation">
      <div className="modal-panel compact-modal-panel" role="dialog" aria-modal="true" ref={panelRef}>
        <div className="modal-head">
          <p>РћРіСЂР°РЅРёС‡РµРЅРёРµ Р±РµСЃРїР»Р°С‚РЅРѕР№ РІРµСЂСЃРёРё</p>
          <button className="icon-button" type="button" aria-label="Р—Р°РєСЂС‹С‚СЊ РѕРєРЅРѕ" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="modal-text">Р’ Р±РµСЃРїР»Р°С‚РЅРѕР№ РІРµСЂСЃРёРё РІРѕР·РјРѕР¶РЅРѕ СЃРѕС…СЂР°РЅРёС‚СЊ С‚РѕР»СЊРєРѕ РѕРґРЅРѕ РѕС‚РѕР±СЂР°Р¶РµРЅРёРµ РѕС‚С‡РµС‚Р°.</p>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            РћС‚РјРµРЅР°
          </button>
          <button className="primary-button" type="button" onClick={onOpenPro}>
            РђРєС‚РёРІРёСЂРѕРІР°С‚СЊ РџР Рћ РІРµСЂСЃРёСЋ
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProVersionModal({ onClose }: { onClose: () => void }) {
  const panelRef = useOutsideClose<HTMLDivElement>(true, onClose);

  return (
    <div className="modal-layer pro-modal-layer" role="presentation">
      <div
        className="modal-panel pro-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pro-modal-title"
        ref={panelRef}
      >
        <div className="modal-head">
          <p id="pro-modal-title">РџР Рћ РІРµСЂСЃРёСЏ</p>
          <button className="icon-button" type="button" aria-label="Р—Р°РєСЂС‹С‚СЊ РѕРєРЅРѕ" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="pro-modal-body">
          <p>Р—РґРµСЃСЊ Р±СѓРґРµС‚ РѕРїРёСЃР°РЅРёРµ С‚Р°СЂРёС„Р°, РІРѕР·РјРѕР¶РЅРѕСЃС‚РµР№ Рё РїРѕРґРєР»СЋС‡РµРЅРёРµ РѕРїР»Р°С‚С‹.</p>
          <p>РџР Рћ РІРµСЂСЃРёСЏ РїРѕР·РІРѕР»СЏРµС‚:</p>
          <ol>
            <li>РЎРѕС…СЂР°РЅСЏС‚СЊ РјРЅРѕР¶РµСЃС‚РІРѕ РІР°СЂРёР°РЅС‚РѕРІ РѕС‚РѕР±СЂР°Р¶РµРЅРёР№ РѕС‚С‡РµС‚Р°.</li>
            <li>Р”Р°С‚СЊ РїСЂР°РІР° СЃРѕС‚СЂСѓРґРЅРёРєР°Рј Рє СЂР°Р·Р»РёС‡РЅС‹Рј РїРѕРєР°Р·Р°С‚РµР»СЏРј РѕС‚С‡РµС‚Р°.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

export function InstructionModal({ onClose }: { onClose: () => void }) {
  const panelRef = useOutsideClose<HTMLDivElement>(true, onClose);

  return (
    <div className="modal-layer instruction-modal-layer" role="presentation">
      <div className="modal-panel instruction-modal-panel" role="dialog" aria-modal="true" ref={panelRef}>
        <div className="modal-head">
          <p>РРЅСЃС‚СЂСѓРєС†РёСЏ</p>
          <button className="icon-button" type="button" aria-label="Р—Р°РєСЂС‹С‚СЊ РѕРєРЅРѕ" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="instruction-content">
          <nav className="instruction-nav" aria-label="Р Р°Р·РґРµР»С‹ РёРЅСЃС‚СЂСѓРєС†РёРё">
            <a href="#instruction-about">Р§С‚Рѕ РґРµР»Р°РµС‚ РїСЂРёР»РѕР¶РµРЅРёРµ</a>
            <a href="#instruction-build">РљР°Рє РїРѕСЃС‚СЂРѕРёС‚СЊ РѕС‚С‡РµС‚</a>
            <a href="#instruction-crm">РџРѕС‡РµРјСѓ Сѓ РІСЃРµС… СЂР°Р·РЅС‹Рµ РІРѕСЂРѕРЅРєРё</a>
            <a href="#instruction-chart">РљР°Рє С‡РёС‚Р°С‚СЊ РіСЂР°С„РёРє</a>
            <a href="#instruction-thresholds">РџРѕСЂРѕРіРѕРІС‹Рµ Р·РЅР°С‡РµРЅРёСЏ</a>
            <a href="#instruction-table">РљР°Рє РїРѕР»СЊР·РѕРІР°С‚СЊСЃСЏ С‚Р°Р±Р»РёС†РµР№</a>
            <a href="#instruction-settings">РќР°СЃС‚СЂРѕР№РєР° С‚Р°Р±Р»РёС†С‹</a>
            <a href="#instruction-views">РЎРѕС…СЂР°РЅРµРЅРЅС‹Рµ РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ</a>
            <a href="#instruction-export">Excel Рё PDF</a>
            <a href="#instruction-pro">РџР Рћ РІРµСЂСЃРёСЏ</a>
            <a href="#instruction-faq">Р§Р°СЃС‚С‹Рµ РІРѕРїСЂРѕСЃС‹</a>
          </nav>

          <section className="instruction-section" id="instruction-about">
            <h2>Р§С‚Рѕ РґРµР»Р°РµС‚ РїСЂРёР»РѕР¶РµРЅРёРµ</h2>
            <p>
              РџСЂРёР»РѕР¶РµРЅРёРµ РїРѕРјРѕРіР°РµС‚ СЃРјРѕС‚СЂРµС‚СЊ РїРѕРєР°Р·Р°С‚РµР»Рё Р‘РёС‚СЂРёРєСЃ24 РІ РіСЂР°С„РёРєР°С… Рё С‚Р°Р±Р»РёС†Р°С…. Р’С‹ РІС‹Р±РёСЂР°РµС‚Рµ РїРµСЂРёРѕРґ,
              CRM-СЂР°Р·РґРµР»С‹ Рё РЅСѓР¶РЅС‹Р№ РІРёРґ СЂР°СЃС‡РµС‚Р°, Р° РїСЂРёР»РѕР¶РµРЅРёРµ РїРѕРєР°Р·С‹РІР°РµС‚ РґРёРЅР°РјРёРєСѓ РїРѕ РґР°С‚Р°Рј.
            </p>
            <p>
              РћС‚С‡РµС‚ РјРѕР¶РЅРѕ СЃРєР°С‡Р°С‚СЊ РІ Excel РёР»Рё PDF. РўР°РєР¶Рµ РјРѕР¶РЅРѕ СЃРѕС…СЂР°РЅРёС‚СЊ СѓРґРѕР±РЅС‹Рµ РІР°СЂРёР°РЅС‚С‹ РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ РѕС‚С‡РµС‚Р°,
              С‡С‚РѕР±С‹ Р±С‹СЃС‚СЂРѕ РІРѕР·РІСЂР°С‰Р°С‚СЊСЃСЏ Рє РЅРёРј РїРѕР·Р¶Рµ.
            </p>
            <div className="instruction-demo demo-toolbar">
              <span className="demo-select">РћР±С‰РёР№ РѕС‚С‡РµС‚</span>
              <span className="demo-button demo-blue">РџРѕСЃС‚СЂРѕРёС‚СЊ РѕС‚С‡РµС‚</span>
              <span className="demo-button demo-green">РЎРєР°С‡Р°С‚СЊ Excel</span>
              <span className="demo-button demo-purple">РЎРєР°С‡Р°С‚СЊ PDF</span>
            </div>
          </section>

          <section className="instruction-section" id="instruction-build">
            <h2>РљР°Рє РїРѕСЃС‚СЂРѕРёС‚СЊ РѕС‚С‡РµС‚</h2>
            <ol>
              <li>Р’С‹Р±РµСЂРёС‚Рµ РїРµСЂРёРѕРґ РІ РІРµСЂС…РЅРµР№ РїР°РЅРµР»Рё.</li>
              <li>РќР°Р¶РјРёС‚Рµ РєРЅРѕРїРєСѓ <b>РќР°СЃС‚СЂРѕРёС‚СЊ РіСЂР°С„РёРє</b>.</li>
              <li>Р’С‹Р±РµСЂРёС‚Рµ РЅСѓР¶РЅС‹Рµ РІРѕСЂРѕРЅРєРё, Р»РёРґС‹, СЃС‡РµС‚Р° РёР»Рё СЃРјР°СЂС‚-РїСЂРѕС†РµСЃСЃС‹.</li>
              <li>Р’С‹Р±РµСЂРёС‚Рµ, С‡С‚Рѕ СЃС‡РёС‚Р°С‚СЊ: РґРµРЅСЊРіРё РёР»Рё РєРѕР»РёС‡РµСЃС‚РІРѕ.</li>
              <li>РќР°Р¶РјРёС‚Рµ <b>РџСЂРёРјРµРЅРёС‚СЊ</b>.</li>
              <li>РќР°Р¶РјРёС‚Рµ <b>РџРѕСЃС‚СЂРѕРёС‚СЊ РѕС‚С‡РµС‚</b>.</li>
            </ol>
            <div className="instruction-demo demo-card">
              <span className="demo-button demo-soft">РќР°СЃС‚СЂРѕРёС‚СЊ РіСЂР°С„РёРє</span>
              <span className="demo-select">Р’РѕСЂРѕРЅРєР° РїСЂРѕРґР°Р¶Рё</span>
              <span className="demo-select">РљРѕР»-РІРѕ РґРµРЅРµРі</span>
              <span className="demo-button demo-blue">РџСЂРёРјРµРЅРёС‚СЊ</span>
            </div>
          </section>

          <section className="instruction-section" id="instruction-crm">
            <h2>РџРѕС‡РµРјСѓ Сѓ РІСЃРµС… СЂР°Р·РЅС‹Рµ РІРѕСЂРѕРЅРєРё</h2>
            <p>
              РџСЂРёР»РѕР¶РµРЅРёРµ Р±РµСЂРµС‚ СЂР°Р·РґРµР»С‹ CRM РёР· РІР°С€РµРіРѕ РїРѕСЂС‚Р°Р»Р° Р‘РёС‚СЂРёРєСЃ24. РџРѕСЌС‚РѕРјСѓ РЅР°Р·РІР°РЅРёСЏ РјРѕРіСѓС‚ РѕС‚Р»РёС‡Р°С‚СЊСЃСЏ РѕС‚
              РїСЂРёРјРµСЂРѕРІ РІ РёРЅСЃС‚СЂСѓРєС†РёРё. РЈ РѕРґРЅРѕРіРѕ РїРѕСЂС‚Р°Р»Р° РјРѕР¶РµС‚ Р±С‹С‚СЊ РІРѕСЂРѕРЅРєР° <b>РџСЂРѕРґР°Р¶Рё</b>, Сѓ РґСЂСѓРіРѕРіРѕ вЂ” <b>РџСЂРѕРёР·РІРѕРґСЃС‚РІРѕ</b>.
            </p>
            <p>
              Р›РёРґС‹ Рё СЃРјР°СЂС‚-РїСЂРѕС†РµСЃСЃС‹ С‚РѕР¶Рµ РјРѕРіСѓС‚ РЅР°Р·С‹РІР°С‚СЊСЃСЏ РїРѕ-СЂР°Р·РЅРѕРјСѓ. Р­С‚Рѕ РЅРѕСЂРјР°Р»СЊРЅРѕ: РІС‹Р±РёСЂР°Р№С‚Рµ С‚Рµ СЂР°Р·РґРµР»С‹,
              РєРѕС‚РѕСЂС‹Рµ РЅСѓР¶РЅС‹ РёРјРµРЅРЅРѕ РІР°С€РµРјСѓ РѕС‚С‡РµС‚Сѓ.
            </p>
          </section>

          <section className="instruction-section" id="instruction-chart">
            <h2>РљР°Рє С‡РёС‚Р°С‚СЊ РіР»Р°РІРЅС‹Р№ РіСЂР°С„РёРє</h2>
            <p>
              РўРѕС‡РєРё РЅР° РіСЂР°С„РёРєРµ РїРѕРєР°Р·С‹РІР°СЋС‚ Р·РЅР°С‡РµРЅРёСЏ РїРѕ РґР°С‚Р°Рј РёР»Рё РїРµСЂРёРѕРґР°Рј. РќР°РІРµРґРёС‚Рµ РєСѓСЂСЃРѕСЂ РЅР° С‚РѕС‡РєСѓ, С‡С‚РѕР±С‹ СѓРІРёРґРµС‚СЊ
              РїРѕРґСЃРєР°Р·РєСѓ СЃ РґР°С‚РѕР№ Рё СЃСѓРјРјРѕР№. Р›РёРЅРёСЏ С‚СЂРµРЅРґР° РїРѕРјРѕРіР°РµС‚ РїРѕРЅСЏС‚СЊ, СЂР°СЃС‚СѓС‚ РїРѕРєР°Р·Р°С‚РµР»Рё РёР»Рё СЃРЅРёР¶Р°СЋС‚СЃСЏ.
            </p>
            <div className="instruction-demo demo-chart">
              <span className="demo-chart-line" />
              <span className="demo-dot demo-dot-one" />
              <span className="demo-dot demo-dot-two" />
              <span className="demo-dot demo-dot-three" />
              <span className="demo-tooltip">15 РјР°СЏ В· 840 000 в‚Ѕ</span>
            </div>
          </section>

          <section className="instruction-section" id="instruction-thresholds">
            <h2>РџРѕСЂРѕРіРѕРІС‹Рµ Р·РЅР°С‡РµРЅРёСЏ</h2>
            <p>
              Р’РµСЂС…РЅРµРµ Р·РЅР°С‡РµРЅРёРµ РїРѕРєР°Р·С‹РІР°РµС‚ С…РѕСЂРѕС€РёР№ СЂРµР·СѓР»СЊС‚Р°С‚. РќРёР¶РЅРµРµ Р·РЅР°С‡РµРЅРёРµ РїРѕРјРѕРіР°РµС‚ Р±С‹СЃС‚СЂРѕ СѓРІРёРґРµС‚СЊ СЃР»Р°Р±С‹Рµ РјРµСЃС‚Р°.
              РЎСЂРµРґРЅРµРµ Р·РЅР°С‡РµРЅРёРµ РЅР°С…РѕРґРёС‚СЃСЏ РјРµР¶РґСѓ РЅРёРјРё. Р—РЅР°С‡РµРЅРёСЏ РјРѕР¶РЅРѕ РІРІРµСЃС‚Рё РІСЂСѓС‡РЅСѓСЋ РёР»Рё РїСЂРёРјРµРЅРёС‚СЊ СЂРµРєРѕРјРµРЅРґРѕРІР°РЅРЅС‹Рµ.
            </p>
            <p>
              Р РµРєРѕРјРµРЅРґРѕРІР°РЅРЅС‹Рµ Р·РЅР°С‡РµРЅРёСЏ СЃС‡РёС‚Р°СЋС‚СЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё РїРѕ РґР°РЅРЅС‹Рј С‚РµРєСѓС‰РµРіРѕ РіСЂР°С„РёРєР° РёР»Рё СЃС‚СЂРѕРєРё С‚Р°Р±Р»РёС†С‹.
            </p>
            <div className="instruction-demo demo-thresholds">
              <div>
                <span>Р СѓС‡РЅС‹Рµ Р·РЅР°С‡РµРЅРёСЏ</span>
                <i>Р’РµСЂС…РЅРµРµ Р·РЅР°С‡РµРЅРёРµ</i>
                <i>РќРёР¶РЅРµРµ Р·РЅР°С‡РµРЅРёРµ</i>
                <i>РЎСЂРµРґРЅРµРµ Р·РЅР°С‡РµРЅРёРµ</i>
                <b>РџСЂРёРјРµРЅРёС‚СЊ</b>
              </div>
              <div>
                <span>Р РµРєРѕРјРµРЅРґРѕРІР°РЅРЅС‹Рµ</span>
                <i>Р РµРєРѕРјРµРЅРґРѕРІР°РЅРЅРѕРµ РІРµСЂС…РЅРµРµ</i>
                <i>Р РµРєРѕРјРµРЅРґРѕРІР°РЅРЅРѕРµ РЅРёР¶РЅРµРµ</i>
                <i>Р РµРєРѕРјРµРЅРґРѕРІР°РЅРЅРѕРµ СЃСЂРµРґРЅРµРµ</i>
                <b className="demo-green-text">РџСЂРёРјРµРЅРёС‚СЊ</b>
              </div>
            </div>
          </section>

          <section className="instruction-section" id="instruction-table">
            <h2>РљР°Рє РїРѕР»СЊР·РѕРІР°С‚СЊСЃСЏ С‚Р°Р±Р»РёС†РµР№</h2>
            <p>
              РЎР»РµРІР° РЅР°С…РѕРґРёС‚СЃСЏ СЃРїРёСЃРѕРє РїРѕРєР°Р·Р°С‚РµР»РµР№, СЃРїСЂР°РІР° вЂ” Р·РЅР°С‡РµРЅРёСЏ РїРѕ РґР°С‚Р°Рј. Р§РµСЂРµР· РјРµРЅСЋ СЃ С‚СЂРµРјСЏ С‚РѕС‡РєР°РјРё РјРѕР¶РЅРѕ
              РїРѕРєР°Р·Р°С‚СЊ СЃРѕС‚СЂСѓРґРЅРёРєРѕРІ, СЂР°СЃРєСЂС‹С‚СЊ РіСЂР°С„РёРє СЃС‚СЂРѕРєРё РёР»Рё РЅР°СЃС‚СЂРѕРёС‚СЊ РїРѕСЂРѕРіРё.
            </p>
            <p>
              РќР°Р¶РјРёС‚Рµ РЅР° С†РёС„СЂСѓ, С‡С‚РѕР±С‹ РѕС‚РєСЂС‹С‚СЊ РґРµС‚Р°Р»РёР·Р°С†РёСЋ. Р•СЃР»Рё Р·РЅР°С‡РµРЅРёРµ РѕР±СЂРµР·Р°РЅРѕ, РЅР°РІРµРґРёС‚Рµ РєСѓСЂСЃРѕСЂ вЂ” РїРѕСЏРІРёС‚СЃСЏ
              РїРѕРґСЃРєР°Р·РєР° СЃ РїРѕР»РЅС‹Рј Р·РЅР°С‡РµРЅРёРµРј.
            </p>
            <div className="instruction-demo demo-table-row">
              <span>РЎСѓРјРјР° СѓСЃРїРµС€РЅС‹С… СЃРґРµР»РѕРє</span>
              <b>812 000 в‚Ѕ</b>
              <b>940 000 в‚Ѕ</b>
              <button type="button" aria-label="РњРµРЅСЋ СЃС‚СЂРѕРєРё">в‹®</button>
            </div>
          </section>

          <section className="instruction-section" id="instruction-settings">
            <h2>РќР°СЃС‚СЂРѕР№РєР° С‚Р°Р±Р»РёС†С‹</h2>
            <p>
              Р’ РЅР°СЃС‚СЂРѕР№РєРµ С‚Р°Р±Р»РёС†С‹ РјРѕР¶РЅРѕ СЃРєСЂС‹С‚СЊ Р»РёС€РЅРёРµ СЂР°Р·РґРµР»С‹. Р’ РЅР°СЃС‚СЂРѕР№РєРµ РїРѕРєР°Р·Р°С‚РµР»РµР№ СЂР°Р·РґРµР»Р° РјРѕР¶РЅРѕ РѕСЃС‚Р°РІРёС‚СЊ
              С‚РѕР»СЊРєРѕ РЅСѓР¶РЅС‹Рµ СЃС‚СЂРѕРєРё. РЎРєСЂС‹С‚С‹Рµ РїРѕРєР°Р·Р°С‚РµР»Рё РЅРµ РїРѕРїР°РґСѓС‚ РІ Excel.
            </p>
            <p>
              РљРЅРѕРїРєР° <b>Р’С‹Р±СЂР°С‚СЊ РІСЃРµ</b> РІРєР»СЋС‡Р°РµС‚ РІСЃРµ РїСѓРЅРєС‚С‹. РљРЅРѕРїРєР° <b>РЎР±СЂРѕСЃРёС‚СЊ</b> РѕС‡РёС‰Р°РµС‚ РІС‹Р±РѕСЂ.
            </p>
            <div className="instruction-demo demo-card">
              <span className="demo-button demo-soft">РќР°СЃС‚СЂРѕР№РєР° С‚Р°Р±Р»РёС†С‹</span>
              <span className="demo-pill">Р’С‹Р±СЂР°С‚СЊ РІСЃРµ</span>
              <span className="demo-pill">РЎР±СЂРѕСЃРёС‚СЊ</span>
              <span className="demo-check">вњ“ РЎРґРµР»РєРё</span>
              <span className="demo-check">вњ“ Р›РёРґС‹</span>
            </div>
          </section>

          <section className="instruction-section" id="instruction-views">
            <h2>РЎРѕС…СЂР°РЅРµРЅРЅС‹Рµ РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ</h2>
            <p>
              Р•СЃР»Рё РІС‹ С‡Р°СЃС‚Рѕ СЃРјРѕС‚СЂРёС‚Рµ РѕС‚С‡РµС‚ РІ РѕРґРЅРѕРј Рё С‚РѕРј Р¶Рµ РІРёРґРµ, СЃРѕС…СЂР°РЅРёС‚Рµ РѕС‚РѕР±СЂР°Р¶РµРЅРёРµ. Р’ Р±РµСЃРїР»Р°С‚РЅРѕР№ РІРµСЂСЃРёРё РјРѕР¶РЅРѕ
              СЃРѕС…СЂР°РЅРёС‚СЊ РѕРґРЅРѕ РѕС‚РѕР±СЂР°Р¶РµРЅРёРµ. Р’ РџР Рћ РІРµСЂСЃРёРё РјРѕР¶РЅРѕ СЃРѕС…СЂР°РЅСЏС‚СЊ РјРЅРѕРіРѕ РІР°СЂРёР°РЅС‚РѕРІ.
            </p>
            <p>
              Р§С‚РѕР±С‹ РїРµСЂРµРёРјРµРЅРѕРІР°С‚СЊ РёР»Рё СѓРґР°Р»РёС‚СЊ РѕС‚РѕР±СЂР°Р¶РµРЅРёРµ, РѕС‚РєСЂРѕР№С‚Рµ РїРѕР»Рµ <b>РћР±С‰РёР№ РѕС‚С‡РµС‚</b> Рё РЅР°Р¶РјРёС‚Рµ С‚СЂРё С‚РѕС‡РєРё
              СЂСЏРґРѕРј СЃ СЃРѕС…СЂР°РЅРµРЅРЅС‹Рј РЅР°Р·РІР°РЅРёРµРј.
            </p>
            <div className="instruction-demo demo-card">
              <span className="demo-select">РћР±С‰РёР№ РѕС‚С‡РµС‚</span>
              <span className="demo-select">РџСЂРѕРґР°Р¶Рё Р·Р° РјРµСЃСЏС† В· в‹®</span>
              <span className="demo-menu-item">Р РµРґР°РєС‚РёСЂРѕРІР°С‚СЊ</span>
              <span className="demo-menu-item">РЈРґР°Р»РёС‚СЊ</span>
            </div>
          </section>

          <section className="instruction-section" id="instruction-export">
            <h2>Excel Рё PDF</h2>
            <p>
              Excel РІС‹РіСЂСѓР¶Р°РµС‚ С‚Р°Р±Р»РёС†Сѓ СЃ РІРёРґРёРјС‹РјРё СЂР°Р·РґРµР»Р°РјРё Рё РїРѕРєР°Р·Р°С‚РµР»СЏРјРё. Р•СЃР»Рё РІС‹ СЃРєСЂС‹Р»Рё СЂР°Р·РґРµР» РёР»Рё РїРѕРєР°Р·Р°С‚РµР»СЊ,
              РѕРЅ РЅРµ РїРѕРїР°РґРµС‚ РІ С„Р°Р№Р».
            </p>
            <p>
              PDF РІС‹РіСЂСѓР¶Р°РµС‚ РІРёР·СѓР°Р»СЊРЅС‹Р№ РѕС‚С‡РµС‚: РІРµСЂС…РЅСЋСЋ РїР°РЅРµР»СЊ, РіР»Р°РІРЅС‹Р№ РіСЂР°С„РёРє Рё С‚Р°Р±Р»РёС†Сѓ. Р•СЃР»Рё С‚Р°Р±Р»РёС†Р° Р±РѕР»СЊС€Р°СЏ,
              PDF РґРѕР»Р¶РµРЅ РІРєР»СЋС‡РёС‚СЊ РµРµ РїРѕР»РЅРѕСЃС‚СЊСЋ.
            </p>
          </section>

          <section className="instruction-section" id="instruction-pro">
            <h2>РџР Рћ РІРµСЂСЃРёСЏ</h2>
            <p>
              РџР Рћ РІРµСЂСЃРёСЏ РїРѕР·РІРѕР»РёС‚ СЃРѕС…СЂР°РЅСЏС‚СЊ РјРЅРѕРіРѕ РІР°СЂРёР°РЅС‚РѕРІ РѕС‚РѕР±СЂР°Р¶РµРЅРёР№ РѕС‚С‡РµС‚Р°. РџРѕР·Р¶Рµ Р·РґРµСЃСЊ РїРѕСЏРІСЏС‚СЃСЏ РїСЂР°РІР°
              СЃРѕС‚СЂСѓРґРЅРёРєРѕРІ РЅР° СЂР°Р·РЅС‹Рµ РїРѕРєР°Р·Р°С‚РµР»Рё Рё РґРѕРїРѕР»РЅРёС‚РµР»СЊРЅС‹Рµ РЅР°СЃС‚СЂРѕР№РєРё РґРѕСЃС‚СѓРїР°.
            </p>
          </section>

          <section className="instruction-section" id="instruction-faq">
            <h2>Р§Р°СЃС‚С‹Рµ РІРѕРїСЂРѕСЃС‹</h2>
            <h3>РџРѕС‡РµРјСѓ СЏ РЅРµ РІРёР¶Сѓ РЅСѓР¶РЅСѓСЋ РІРѕСЂРѕРЅРєСѓ?</h3>
            <p>РџСЂРѕРІРµСЂСЊС‚Рµ, РµСЃС‚СЊ Р»Рё СЌС‚Р° РІРѕСЂРѕРЅРєР° РІ РІР°С€РµРј Р‘РёС‚СЂРёРєСЃ24 Рё РґРѕСЃС‚СѓРїРЅР° Р»Рё РѕРЅР° РІР°С€РµРјСѓ РїРѕР»СЊР·РѕРІР°С‚РµР»СЋ.</p>
            <h3>РџРѕС‡РµРјСѓ РЅР°Р·РІР°РЅРёСЏ РѕС‚Р»РёС‡Р°СЋС‚СЃСЏ РѕС‚ РёРЅСЃС‚СЂСѓРєС†РёРё?</h3>
            <p>РРЅСЃС‚СЂСѓРєС†РёСЏ РїРѕРєР°Р·С‹РІР°РµС‚ РїСЂРёРјРµСЂС‹. Р’ РІР°С€РµРј РїРѕСЂС‚Р°Р»Рµ РІРѕСЂРѕРЅРєРё, Р»РёРґС‹ Рё СЃРјР°СЂС‚-РїСЂРѕС†РµСЃСЃС‹ РјРѕРіСѓС‚ РЅР°Р·С‹РІР°С‚СЊСЃСЏ РёРЅР°С‡Рµ.</p>
            <h3>РџРѕС‡РµРјСѓ РѕС‚С‡РµС‚ РїСѓСЃС‚РѕР№?</h3>
            <p>РЎРЅР°С‡Р°Р»Р° РІС‹Р±РµСЂРёС‚Рµ РЅР°СЃС‚СЂРѕР№РєРё Рё РЅР°Р¶РјРёС‚Рµ <b>РџРѕСЃС‚СЂРѕРёС‚СЊ РѕС‚С‡РµС‚</b>. РўР°РєР¶Рµ РїСЂРѕРІРµСЂСЊС‚Рµ РІС‹Р±СЂР°РЅРЅС‹Р№ РїРµСЂРёРѕРґ.</p>
            <h3>РљР°Рє СЃРєР°С‡Р°С‚СЊ РѕС‚С‡РµС‚?</h3>
            <p>РќР°Р¶РјРёС‚Рµ <b>РЎРєР°С‡Р°С‚СЊ Excel</b> РґР»СЏ С‚Р°Р±Р»РёС†С‹ РёР»Рё <b>РЎРєР°С‡Р°С‚СЊ PDF</b> РґР»СЏ РІРёР·СѓР°Р»СЊРЅРѕРіРѕ РѕС‚С‡РµС‚Р°.</p>
            <h3>РљР°Рє РѕС‚РєСЂС‹С‚СЊ РґРµС‚Р°Р»РёР·Р°С†РёСЋ?</h3>
            <p>РќР°Р¶РјРёС‚Рµ РЅР° Р»СЋР±СѓСЋ С†РёС„СЂСѓ РІ С‚Р°Р±Р»РёС†Рµ. РћС‚РєСЂРѕРµС‚СЃСЏ РѕРєРЅРѕ СЃРѕ СЃРїРёСЃРєРѕРј СЌР»РµРјРµРЅС‚РѕРІ.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

export function EmployeeMultiSelect({
  label,
  selectedIds,
  onChange,
}: {
  label: string;
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useOutsideClose<HTMLDivElement>(open, () => setOpen(false));
  const selectedEmployees = mockEmployees.filter((employee) => selectedIds.includes(employee.id));
  const normalizedQuery = query.trim().toLowerCase();
  // TODO: Р·Р°РјРµРЅРёС‚СЊ mockEmployees РЅР° Р·Р°РіСЂСѓР·РєСѓ Р°РєС‚РёРІРЅС‹С… СЃРѕС‚СЂСѓРґРЅРёРєРѕРІ РїРѕСЂС‚Р°Р»Р° С‡РµСЂРµР· Bitrix24 user.get.
  const filteredEmployees = mockEmployees.filter((employee) => {
    if (!normalizedQuery) {
      return true;
    }

    return (
      employee.firstName.toLowerCase().startsWith(normalizedQuery) ||
      employee.lastName.toLowerCase().startsWith(normalizedQuery) ||
      `${employee.firstName} ${employee.lastName}`.toLowerCase().startsWith(normalizedQuery)
    );
  });

  const toggleEmployee = (employeeId: string) => {
    onChange(
      selectedIds.includes(employeeId)
        ? selectedIds.filter((id) => id !== employeeId)
        : [...selectedIds, employeeId],
    );
  };

  return (
    <div className={`employee-multi-field ${open ? 'is-open' : ''}`} ref={ref}>
      <span>{label}</span>
      <button
        className="employee-multi-trigger"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="employee-chip-list">
          {selectedEmployees.length ? (
            selectedEmployees.map((employee) => (
              <span className="employee-chip" key={employee.id}>
                {employee.firstName} {employee.lastName}
              </span>
            ))
          ) : (
            <span className="employee-placeholder">РќРµ РІС‹Р±СЂР°РЅРѕ</span>
          )}
        </span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="employee-multi-popover">
          <div className="employee-multi-head">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="РџРѕРёСЃРє СЃРѕС‚СЂСѓРґРЅРёРєР°"
            />
            <button className="row-menu-close" type="button" aria-label="Р—Р°РєСЂС‹С‚СЊ СЃРїРёСЃРѕРє" onClick={() => setOpen(false)}>
              <X size={14} />
            </button>
          </div>
          <div className="employee-multi-list">
            {filteredEmployees.map((employee) => (
              <label className="employee-multi-option" key={employee.id}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(employee.id)}
                  onChange={() => toggleEmployee(employee.id)}
                />
                <span>{employee.firstName} {employee.lastName}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AppSettingsModal({
  settings,
  onSave,
  onClose,
  onOpenPro,
}: {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
  onOpenPro: () => void;
}) {
  const [draftSettings, setDraftSettings] = useState<AppSettings>(() => ({
    reportBuilderUserIds: [...settings.reportBuilderUserIds],
    moneyViewerUserIds: [...settings.moneyViewerUserIds],
    viewSaverUserIds: [...settings.viewSaverUserIds],
  }));
  const panelRef = useOutsideClose<HTMLDivElement>(true, onClose);

  const updateField = (field: keyof AppSettings, values: string[]) => {
    setDraftSettings((current) => ({
      ...current,
      [field]: values,
    }));
  };

  return (
    <div className="modal-layer app-settings-modal-layer" role="presentation">
      <div className="modal-panel app-settings-modal-panel" role="dialog" aria-modal="true" ref={panelRef}>
        <div className="modal-head">
          <div>
            <p>РќР°СЃС‚СЂРѕР№РєРё РїСЂРёР»РѕР¶РµРЅРёСЏ</p>
            <span>РќР°СЃС‚СЂР°РёРІР°С‚СЊ РїСЂРёР»РѕР¶РµРЅРёРµ РјРѕР¶РµС‚ С‚РѕР»СЊРєРѕ Р°РґРјРёРЅРёСЃС‚СЂР°С‚РѕСЂ РїРѕСЂС‚Р°Р»Р°.</span>
          </div>
          <button className="icon-button" type="button" aria-label="Р—Р°РєСЂС‹С‚СЊ РѕРєРЅРѕ" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <p className="modal-text">
          РќР°СЃС‚СЂРѕР№РєРё РІРѕР·РјРѕР¶РЅС‹ РїСЂРё Р°РєС‚РёРІРЅРѕР№ РїРѕРґРїРёСЃРєРµ{' '}
          <button className="pro-inline-link" type="button" onClick={onOpenPro}>
            РџР Рћ РІРµСЂСЃРёРё
          </button>.
        </p>
        <div className="app-settings-fields">
          <EmployeeMultiSelect
            label="РЎРѕС‚СЂСѓРґРЅРёРєРё, РєРѕС‚РѕСЂС‹Рј СЂР°Р·СЂРµС€РµРЅРѕ СЃС‚СЂРѕРёС‚СЊ РѕС‚С‡РµС‚С‹:"
            selectedIds={draftSettings.reportBuilderUserIds}
            onChange={(values) => updateField('reportBuilderUserIds', values)}
          />
          <EmployeeMultiSelect
            label="РЎРѕС‚СЂСѓРґРЅРёРєРё, РєРѕС‚РѕСЂС‹Рј СЂР°Р·СЂРµС€РµРЅРѕ РІРёРґРµС‚СЊ РїРѕРєР°Р·Р°С‚РµР»Рё СЃ РґРµРЅСЊРіР°РјРё:"
            selectedIds={draftSettings.moneyViewerUserIds}
            onChange={(values) => updateField('moneyViewerUserIds', values)}
          />
          <EmployeeMultiSelect
            label="РЎРѕС‚СЂСѓРґРЅРёРєРё, РєРѕС‚РѕСЂС‹Рј СЂР°Р·СЂРµС€РµРЅРѕ СЃРѕС…СЂР°РЅСЏС‚СЊ РѕС‚РѕР±СЂР°Р¶РµРЅРёСЏ РѕС‚С‡РµС‚Р°:"
            selectedIds={draftSettings.viewSaverUserIds}
            onChange={(values) => updateField('viewSaverUserIds', values)}
          />
        </div>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            РћС‚РјРµРЅР°
          </button>
          <button className="primary-button" type="button" onClick={() => onSave(draftSettings)}>
            РЎРѕС…СЂР°РЅРёС‚СЊ
          </button>
        </div>
      </div>
    </div>
  );
}

export function DetailModal({
  context,
  onClose,
}: {
  context: DetailContext;
  onClose: () => void;
}) {
  const [sort, setSort] = useState<DetailSort>({ key: 'rowNumber', direction: 'asc' });
  const [columnWidths, setColumnWidths] = useState<Record<DetailColumnKey, number>>(
    () => loadDetailColumnWidths(),
  );
  const resizeStateRef = useRef<{
    key: DetailColumnKey;
    startX: number;
    startWidths: Record<DetailColumnKey, number>;
    containerWidth: number;
  } | null>(null);
  const detailTableWrapRef = useRef<HTMLDivElement>(null);
  const [detailTableViewportWidth, setDetailTableViewportWidth] = useState(0);
  const rows = useMemo(() => buildMockDetailRows(context), [context]);
  const sortedRows = useMemo(() => {
    const nextRows = [...rows].sort((a, b) => compareDetailValues(a, b, sort.key));

    return sort.direction === 'asc' ? nextRows : nextRows.reverse();
  }, [rows, sort]);
  const detailColumnWidthSum = useMemo(
    () => detailColumns.reduce((sum, column) => sum + columnWidths[column.key], 0),
    [columnWidths],
  );
  const detailTableWidth =
    detailTableViewportWidth > 0
      ? Math.max(detailColumnMinWidthSum, detailTableViewportWidth)
      : detailColumnWidthSum;
  const detailFillerWidth = Math.max(0, detailTableWidth - detailColumnWidthSum);
  const detailTableStyle = useMemo<CSSProperties>(
    () => ({
      gridTemplateColumns: [
        ...detailColumns.map((column) => `${columnWidths[column.key]}px`),
        `${detailFillerWidth}px`,
      ].join(' '),
      width: `${detailTableWidth}px`,
      minWidth: '100%',
    }),
    [columnWidths, detailFillerWidth, detailTableWidth],
  );

  useEffect(() => {
    const node = detailTableWrapRef.current;

    if (!node) {
      return undefined;
    }

    const update = () => {
      setDetailTableViewportWidth(Math.floor(node.clientWidth));
    };

    update();
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;

    resizeObserver?.observe(node);
    window.addEventListener('resize', update);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    if (detailTableViewportWidth <= 0) {
      return;
    }

    setColumnWidths((current) => {
      const normalized = normalizeDetailColumnWidths(current, detailTableViewportWidth);
      return sumDetailColumnWidths(normalized) === sumDetailColumnWidths(current) &&
        detailColumns.every((column) => normalized[column.key] === current[column.key])
        ? current
        : normalized;
    });
  }, [detailTableViewportWidth]);

  useEffect(() => {
    if (detailTableViewportWidth <= 0 || typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(DETAIL_COLUMN_STORAGE_KEY, JSON.stringify(columnWidths));
    } catch {
      // localStorage РјРѕР¶РµС‚ Р±С‹С‚СЊ РЅРµРґРѕСЃС‚СѓРїРµРЅ РІ РїСЂРёРІР°С‚РЅРѕРј СЂРµР¶РёРјРµ, resize РїСЂРё СЌС‚РѕРј РґРѕР»Р¶РµРЅ СЂР°Р±РѕС‚Р°С‚СЊ.
    }
  }, [columnWidths, detailTableViewportWidth]);

  useEffect(
    () => () => {
      document.body.classList.remove('is-detail-resizing');
    },
    [],
  );

  const toggleSort = (key: DetailColumnKey) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const startColumnResize = (
    column: { key: DetailColumnKey; minWidth: number },
    event: ReactPointerEvent<HTMLSpanElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = {
      key: column.key,
      startX: event.clientX,
      startWidths: normalizeDetailColumnWidths(columnWidths, detailTableViewportWidth),
      containerWidth: detailTableViewportWidth,
    };
    document.body.classList.add('is-detail-resizing');

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const state = resizeStateRef.current;

      if (!state) {
        return;
      }

      const nextWidths = resizeDetailColumnWidths(
        state.startWidths,
        state.key,
        moveEvent.clientX - state.startX,
        state.containerWidth,
      );

      setColumnWidths(nextWidths);
    };

    const handlePointerUp = () => {
      resizeStateRef.current = null;
      document.body.classList.remove('is-detail-resizing');
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  return (
    <div
      className="detail-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <div className="detail-head">
          <div>
            <p id="detail-title">Р”РµС‚Р°Р»РёР·Р°С†РёСЏ: {context.metric.label}</p>
            <span>
              {context.point.label} В· {formatMetricValue(context.value, context.metric.type)} В· {bitrixEntityLabels[context.entityType]}
              {context.employee ? ` В· ${context.employee.firstName} ${context.employee.lastName}` : ''}
            </span>
          </div>
          <button className="icon-button" type="button" aria-label="Р—Р°РєСЂС‹С‚СЊ РґРµС‚Р°Р»РёР·Р°С†РёСЋ" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="details-table-scroll detail-table-wrap" ref={detailTableWrapRef}>
          <div className="detail-table" role="table" style={detailTableStyle}>
            {detailColumns.map((column) => (
              <button
                className="detail-header-cell"
                type="button"
                role="columnheader"
                key={column.key}
                onClick={() => toggleSort(column.key)}
              >
                <span>{column.label}</span>
                {sort.key === column.key && (
                  <span className="sort-indicator">{sort.direction === 'asc' ? 'в†‘' : 'в†“'}</span>
                )}
                <span
                  className="column-resizer"
                  role="separator"
                  aria-label={`РР·РјРµРЅРёС‚СЊ С€РёСЂРёРЅСѓ: ${column.label}`}
                  onPointerDown={(event) => startColumnResize(column, event)}
                />
              </button>
            ))}
            <div className="detail-filler-cell detail-header-filler" aria-hidden="true" />

            {sortedRows.map((row) => (
              <div className="detail-row-contents" role="row" key={row.entityId}>
                <div className="detail-cell">{row.rowNumber}</div>
                <button
                  className="detail-cell detail-action-cell"
                  type="button"
                  onClick={() => openBitrixEntity(row.entityType, row.entityId)}
                >
                  {row.entityId}
                </button>
                <button
                  className="detail-cell detail-action-cell detail-title-cell"
                  type="button"
                  onClick={() => openBitrixEntity(row.entityType, row.entityId)}
                >
                  {row.title}
                </button>
                <button
                  className="detail-cell detail-action-cell"
                  type="button"
                  onClick={() => openBitrixUser(row.responsibleId)}
                >
                  {row.responsibleName}
                </button>
                <div className="detail-cell">{row.createdAt}</div>
                <div className="detail-filler-cell" aria-hidden="true" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

