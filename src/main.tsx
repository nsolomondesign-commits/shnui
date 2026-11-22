import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowLeft, ArrowRight, Check, CircleHelp, Crosshair, FileText, Layers2, Maximize, Minus, Plus, RotateCcw, UploadCloud } from 'lucide-react'
import './style.css'

type Matrix = [[number, number, number], [number, number, number]]
type Point = [number, number]
type Plan = { name: string; width: number; height: number }
type Project = {
  id: string; source: Plan; revision: Plan
  registration: { quality: 'good' | 'review' | 'failed'; matrix: Matrix | null; anchors: {target: Point}[];
    metrics: {inliers: number; ratio: number; median_error: number; coverage: number} | null }
  approval: {matrix: Matrix; manual: boolean} | null
}
type Selection = { file: File; preview: string }
type Transform = { x: number; y: number; angle: number; scale: number }
const identity: Matrix = [[1, 0, 0], [0, 1, 0]]
const roles = ['source', 'revision'] as const
const names = {source: 'תכנית מקור', revision: 'תכנית שינויים'}
const descriptions = {source: 'הגרסה המקורית של התכנית', revision: 'הגרסה המעודכנת להשוואה'}

async function request(path: string, init?: RequestInit) {
  const result = await fetch('/api' + path, init)
  if (!result.ok) {
    const body = await result.json().catch(() => null)
    throw Error(typeof body?.detail === 'string' ? body.detail : 'הפעולה נכשלה. אפשר לנסות שוב.')
  }
  return result
}

function asTransform(matrix: Matrix): Transform {
  return { x: matrix[0][2], y: matrix[1][2], angle: Math.atan2(matrix[1][0], matrix[0][0]) * 180 / Math.PI,
    scale: Math.hypot(matrix[0][0], matrix[1][0]) }
}
function asMatrix({x, y, angle, scale}: Transform): Matrix {
  const a = scale * Math.cos(angle * Math.PI / 180)
  const b = scale * Math.sin(angle * Math.PI / 180)
  return [[a, -b, x], [b, a, y]]
}
function sameTransform(a: Transform, b: Transform) {
  return Math.abs(a.x - b.x) < 1e-8 && Math.abs(a.y - b.y) < 1e-8
    && Math.abs(a.angle - b.angle) < 1e-8 && Math.abs(a.scale - b.scale) < 1e-8
}
function svgMatrix([[a,b,x],[c,d,y]]: Matrix) { return `matrix(${a} ${c} ${b} ${d} ${x} ${y})` }
function message(error: unknown) { return error instanceof Error ? error.message : 'אירעה שגיאה.' }

function UploadCard({ role, value, onChange, disabled }: { role: typeof roles[number]; value?: Selection; onChange: (selection?: Selection) => void; disabled: boolean }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => () => { if (value) URL.revokeObjectURL(value.preview) }, [value])
  async function select(file?: File) {
    if (!file || disabled || busy) return
    setError('')
    if (file.size > 20 * 1024 * 1024) { setError('גודל הקובץ המרבי הוא 20MB.'); return }
    setBusy(true)
    const data = new FormData()
    data.append('file', file)
    try {
      const response = await request('/preview', {method: 'POST', body: data})
      onChange({file, preview: URL.createObjectURL(await response.blob())})
    } catch (error) { setError(message(error)) }
    finally { setBusy(false) }
  }
  return <article className={'upload-card ' + role}>
    <div className="card-title"><span className="plan-icon"><FileText size={22}/></span><div><h2>{names[role]}</h2><p>{descriptions[role]}</p></div></div>
    <input ref={input} type="file" accept=".pdf,application/pdf" hidden onChange={event => { void select(event.target.files?.[0]); event.target.value = '' }}/>
    <button type="button" className={'dropzone ' + (drag ? 'drag ' : '') + (value ? 'has-preview' : '')}
      disabled={disabled || busy} onClick={() => input.current?.click()}
      onDragOver={event => { event.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={event => { event.preventDefault(); setDrag(false); void select(event.dataTransfer.files[0]) }}>
      {value ? <img src={value.preview} alt={names[role]}/> : <span className="upload-icon"><UploadCloud size={24}/></span>}
      <strong>{busy ? 'בודק את הקובץ…' : value ? 'בחירת קובץ אחר' : 'גררו לכאן קובץ PDF'}</strong>
      {!value && !busy && <span>או <b>לחצו לבחירת קובץ</b></span>}
    </button>
    {value && <div className="filename"><Check size={16}/><bdi>{value.file.name}</bdi><button className="text-button" disabled={disabled || busy} onClick={() => onChange()}>הסרה</button></div>}
    {!value && <p className="file-hint">עמוד אחד · עד 20MB</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </article>
}

function Viewer({project, matrix, opacity, mode, anchors}: {project: Project; matrix: Matrix; opacity: number; mode: string; anchors: boolean}) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Point>([0, 0])
  const drag = useRef<{ point: Point; pan: Point } | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const {width, height} = mode === 'source' ? project.source : project.revision
  const base = '/api/projects/' + project.id + '/image/'
  function position(event: PointerEvent<SVGSVGElement>): Point {
    const el = event.currentTarget
    const point = el.createSVGPoint()
    point.x = event.clientX; point.y = event.clientY
    const result = point.matrixTransform(el.getScreenCTM()?.inverse())
    return [result.x, result.y]
  }
  useEffect(() => { setZoom(1); setPan([0,0]) }, [mode])
  useEffect(() => {
    const el = svg.current
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      setZoom(previous => Math.min(8, Math.max(0.5, previous * (event.deltaY < 0 ? 1.15 : 1 / 1.15))))
    }
    el?.addEventListener('wheel', wheel, {passive: false})
    return () => el?.removeEventListener('wheel', wheel)
  }, [])
  return <div className="viewer">
    <svg ref={svg} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="תצוגת תכניות"
      onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = {point: position(event), pan} }}
      onPointerMove={event => {
        const start = drag.current
        if (!start) return
        const next = position(event)
        setPan([start.pan[0] + next[0] - start.point[0], start.pan[1] + next[1] - start.point[1]])
      }}
      onLostPointerCapture={() => { drag.current = null }}>
      <defs>
        <filter id="blue" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values=".78 0 0 0 .22  .58 0 0 0 .42  .12 0 0 0 .88  0 0 0 1 0"/></filter>
        <filter id="teal" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values=".95 0 0 0 .05  .42 0 0 0 .58  .49 0 0 0 .51  0 0 0 1 0"/></filter>
      </defs>
      <g transform={`translate(${pan[0] + width/2} ${pan[1] + height/2}) scale(${zoom}) translate(${-width/2} ${-height/2})`} style={{isolation: 'isolate'}}>
        {mode !== 'source' && <image href={base + 'revision'} width={project.revision.width} height={project.revision.height} filter={mode === 'overlay' ? 'url(#teal)' : undefined}/>}
        {mode !== 'revision' && <image href={base + 'source'} width={project.source.width} height={project.source.height}
          transform={mode === 'overlay' ? svgMatrix(matrix) : undefined}
          filter={mode === 'overlay' ? 'url(#blue)' : undefined} opacity={mode === 'overlay' ? opacity : 1} style={{mixBlendMode: 'multiply'}}/>}
        {mode === 'overlay' && anchors && project.registration.anchors.map(({target: [x,y]}, index) =>
          <circle key={index} cx={x} cy={y} r={5/zoom} fill="#ef9e2c" stroke="#fff" strokeWidth={1.5/zoom}/>)}
      </g>
    </svg>
    <div className="zoom" dir="ltr">
      <button aria-label="הקטנה" onClick={() => setZoom(previous => Math.max(.5, previous / 1.25))}><Minus size={17}/></button>
      <output>{Math.round(zoom*100)}%</output>
      <button aria-label="הגדלה" onClick={() => setZoom(previous => Math.min(8, previous * 1.25))}><Plus size={17}/></button>
      <button aria-label="התאמה למסך" onClick={() => {setZoom(1); setPan([0,0])}}><Maximize size={16}/></button>
    </div>
  </div>
}

function Alignment({project, onApproved}: {project: Project; onApproved: (value: Project['approval']) => void}) {
  const initial = project.registration.matrix ?? identity
  const [transform, setTransform] = useState(() => asTransform(project.approval?.matrix ?? initial))
  const [manual, setManual] = useState(project.approval?.manual ?? false)
  const [opacity, setOpacity] = useState(.65)
  const [mode, setMode] = useState('overlay')
  const [anchors, setAnchors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const matrix = asMatrix(transform)
  const {quality, metrics} = project.registration
  const changed = !sameTransform(transform, asTransform(initial))
  const currentApproval = project.approval && sameTransform(transform, asTransform(project.approval.matrix))
  async function approve() {
    setSaving(true); setError('')
    try {
      const result = await request('/projects/' + project.id + '/approval', {method:'PUT',
        headers:{'Content-Type':'application/json'}, body:JSON.stringify({matrix,manual})})
      onApproved(await result.json())
    } catch (error) { setError(message(error)) }
    finally { setSaving(false) }
  }
  const fields: {key: keyof Transform; label: string; step: number}[] = [
    {key:'x', label:'הזזה אופקית (px)', step:1}, {key:'y', label:'הזזה אנכית (px)', step:1},
    {key:'angle', label:'זווית (°)', step:.1}, {key:'scale', label:'קנה מידה', step:.01}
  ]
  return <div className="alignment">
    <section className="drawing-panel">
      <div className="drawing-toolbar"><div className="modes">{[['overlay','שכבות'],['source','מקור'],['revision','שינויים']].map(([key,label]) =>
        <button className={mode === key ? 'selected' : ''} aria-pressed={mode === key} key={key} onClick={() => setMode(key)}>{label}</button>)}</div>
        <label className="anchor-toggle"><input type="checkbox" checked={anchors} onChange={event => setAnchors(event.target.checked)} disabled={mode !== 'overlay' || !metrics}/> נקודות עיגון</label></div>
      <Viewer project={project} matrix={matrix} opacity={opacity} mode={mode} anchors={anchors}/>
      <div className="legend"><span className="source-dot"/>תכנית מקור <span className="revision-dot"/>תכנית שינויים</div>
    </section>
    <aside className="controls">
      <h2><Crosshair size={19}/> איכות היישור האוטומטי</h2>
      <div className={'status ' + quality}>{({good:'יישור טוב',review:'היישור דורש בדיקה',failed:'לא נמצאה התאמה מספקת'})[quality]}</div>
      <p>{metrics ? `${metrics.inliers} התאמות · שגיאה חציונית ${metrics.median_error.toFixed(1)} פיקסלים` : 'אפשר לנסות ליישר את התכניות ידנית.'}</p>
      {metrics && <p>{Math.round(metrics.ratio * 100)}% מההתאמות עברו סינון · פיזור {Math.round(metrics.coverage * 100)}%</p>}
      <hr/>
      <label className="opacity"><span>שקיפות המקור</span><output>{Math.round(opacity * 100)}%</output>
        <input aria-label="שקיפות המקור" type="range" min="0" max="1" step=".01" value={opacity} onChange={event => setOpacity(Number(event.target.value))} disabled={mode !== 'overlay'}/></label>
      <hr/>
      <div className="settings-title"><h2>תיקון ידני</h2><button className="text-button" disabled={saving} onClick={() => {setTransform(asTransform(initial)); setManual(false)}}><RotateCcw size={14}/> איפוס</button></div>
      <div className="fields">{fields.map(({key,label,step}) =>
        <NumberField key={key} label={label} value={transform[key]} step={step} disabled={saving}
          update={value => {if (key === 'scale' && (value < .005 || value > 100)) return; setTransform({...transform,[key]:value}); setManual(true); setMode('overlay')}}/>)}</div>
      <button className="primary approval" disabled={saving || !!currentApproval || (quality === 'failed' && !changed)} onClick={approve}>
        <Check size={18}/>{saving ? 'שומר…' : currentApproval ? 'היישור אושר ונשמר' : 'אישור יישור'}</button>
      {error && <p className="error" role="alert">{error}</p>}
    </aside>
  </div>
}

function NumberField({label,value,step,disabled,update}: {label:string;value:number;step:number;disabled:boolean;update:(value:number)=>void}) {
  const [draft,setDraft] = useState<string | null>(null)
  return <label>{label}<input type="number" dir="ltr" step={step} disabled={disabled}
    value={draft ?? Number(value.toFixed(4))} onBlur={() => setDraft(null)}
    onChange={event => {
      setDraft(event.target.value)
      if (Number.isFinite(event.target.valueAsNumber)) update(event.target.valueAsNumber)
    }}/></label>
}

function App() {
  const [files, setFiles] = useState<Partial<Record<typeof roles[number], Selection>>>({})
  const [project, setProject] = useState<Project | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('project')
    if (!id) return
    const controller = new AbortController()
    setWorking(true)
    request('/projects/' + encodeURIComponent(id), {signal: controller.signal}).then(response => response.json()).then(setProject)
      .catch(error => {if (!controller.signal.aborted) setError(message(error))})
      .finally(() => { if (!controller.signal.aborted) setWorking(false) })
    return () => controller.abort()
  }, [])
  async function start() {
    if (!files.source || !files.revision) return
    setWorking(true); setError('')
    const form = new FormData()
    form.append('source', files.source.file)
    form.append('revision', files.revision.file)
    try {
      const response = await request('/projects', {method:'POST',body:form})
      const next: Project = await response.json()
      history.replaceState(null, '', '?project=' + next.id)
      setProject(next)
    } catch (error) { setError(message(error)) }
    finally { setWorking(false) }
  }
  function back() {
    history.replaceState(null, '', location.pathname)
    setProject(null); setFiles({}); setError('')
  }
  const step = (number: number, label: ReactNode, active: boolean, done = false) =>
    <li className={active ? 'active' : done ? 'done' : ''} aria-current={active ? 'step' : undefined}><span>{done ? <Check size={15}/> : number}</span>{label}</li>
  return <>
    <header className="top"><div className="top-inner"><div className="brand"><span className="brand-icon"><Layers2 size={23}/></span><b dir="ltr">PlanDiff</b></div><span className="top-label">כלי להשוואת תכניות אדריכליות</span></div></header>
    <main>
      <ol className="steps" aria-label="שלבי עבודה">{step(1,'העלאת תכניות',!project,!!project)}{step(2,'יישור ואישור',!!project)}</ol>
      <div className="heading">
        <h1>{project ? 'יישור תכניות' : 'השוואת תכניות'}</h1>
        <p>{project ? 'בדקו את החפיפה בין התכניות, תקנו במידת הצורך ואשרו את היישור.' : 'העלו את תכנית המקור ואת תכנית השינויים כדי ליישר אותן זו על גבי זו.'}</p>
      </div>
      {project ? <>
        <button className="text-button back" onClick={back}><ArrowRight size={16}/> העלאה חדשה</button>
        <Alignment key={project.id} project={project} onApproved={approval => setProject({...project, approval})}/>
      </> : <>
        <section className="uploads" aria-label="העלאת תכניות">{roles.map(role =>
          <UploadCard key={role} role={role} value={files[role]} disabled={working}
            onChange={value => setFiles(previous => ({...previous,[role]:value}))}/>)}</section>
        <div className="upload-actions"><div className="tip"><CircleHelp size={17}/> ניתן להעלות גם תכניות סרוקות כ־PDF.</div>
          <button className="primary" disabled={working || !files.source || !files.revision} onClick={start}>
            {working ? 'מכין את התכניות…' : 'המשך ליישור'}<ArrowLeft size={18}/></button></div>
      </>}
      {error && <p className="error" role="alert">{error}</p>}
    </main>
  </>
}

createRoot(document.getElementById('root')!).render(<App/>)
