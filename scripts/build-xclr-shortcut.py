import plistlib, uuid, sys
OBJ="￼"
def U(): return str(uuid.uuid4()).upper()
def tok(parts):
    """parts: list of str or (name, uuid) -> WFTextTokenString"""
    s=""; att={}
    for p in parts:
        if isinstance(p,str): s+=p
        else:
            att["{%d, 1}"%len(s)]={"OutputName":p[0],"OutputUUID":p[1],"Type":"ActionOutput"}
            s+=OBJ
    v={"string":s}
    if att: v["attachmentsByRange"]=att
    return {"Value":v,"WFSerializationType":"WFTextTokenString"}
def attach(name,u):
    return {"Value":{"OutputName":name,"OutputUUID":u,"Type":"ActionOutput"},"WFSerializationType":"WFTextTokenAttachment"}
def act(ident, params): return {"WFWorkflowActionIdentifier":ident,"WFWorkflowActionParameters":params}

def type_row(label):
    return {"Bounded":True,"Operator":4,"Property":"Type","Removable":False,
            "Values":{"Enumeration":{"Value":label,"WFSerializationType":"WFStringSubstitutableState"}}}
TODAY={"Bounded":True,"Operator":1002,"Property":"Start Date","Removable":False,"Values":{"Number":"7","Unit":16}}
LAST_DAY={"Bounded":True,"Operator":1001,"Property":"Start Date","Removable":False,"Values":{"Number":1,"Unit":16384}}
def find(label, date_row, u, sort=False, limit=None):
    p={"UUID":u,"WFContentItemFilter":{"Value":{"WFActionParameterFilterPrefix":1,"WFContentPredicateBoundedDate":False,
        "WFActionParameterFilterTemplates":[type_row(label)]+([date_row] if date_row else [])},
        "WFSerializationType":"WFContentPredicateTableTemplate"}}
    if sort:
        p["WFContentItemSortProperty"]="Start Date"; p["WFContentItemSortOrder"]="Latest First"
    if limit:
        p["WFContentItemLimitEnabled"]=True; p["WFContentItemLimitNumber"]=float(limit)
    return act("is.workflow.actions.filter.health.quantity",p)
def detail(prop, src_u, u):
    return act("is.workflow.actions.properties.health.quantity",{"UUID":u,"WFContentItemPropertyName":prop,"WFInput":attach("Health Samples",src_u)})
def comment(t): return act("is.workflow.actions.comment",{"WFCommentActionText":t})

acts=[]; Q=[]
key_u=U()
acts.append(comment("Built for Xclr (xclr.vercel.app). Runs on its own from Automations 3x a day."))
acts.append(comment("Xclr Sync — sends today's steps, active calories, last night's sleep and resting heart rate to your Xclr app. Your key is in the Text below; get a new one in Xclr → Goals → Profile → Watch & phone sync."))
acts.append(act("is.workflow.actions.gettext",{"UUID":key_u,"WFTextActionText":"PASTE-YOUR-XCLR-KEY"}))
Q.append({"ActionIndex":2,"Category":"Parameter","DefaultValue":"","ParameterKey":"WFTextActionText",
          "Text":"Paste your Xclr key. In Xclr: Goals → Profile → Watch & phone sync → Copy my sync link, then tap Copy key. Paste only the key (without the word Bearer)."})
fields=[]
def metric(label, date_row, outs, **kw):
    fu=U(); acts.append(find(label,date_row,fu,**kw))
    for prop,key in outs:
        du=U(); acts.append(detail(prop,fu,du)); fields.append((key,(prop,du)))
acts.append(comment("Read today's numbers from Apple Health."))
metric("Steps",TODAY,[("Value","steps_values"),("Source","steps_sources")])
metric("Active Calories",TODAY,[("Value","active_values"),("Source","active_sources")])
metric("Sleep",LAST_DAY,[("Value","sleep_values"),("Duration","sleep_durations"),("Source","sleep_sources")])
metric("Resting Heart Rate",None,[("Value","resting_hr")],sort=True,limit=1)

def item(k, v):
    return {"WFItemType":0,"WFKey":tok([k]),"WFValue":tok(v)}
items=[item("format",["shortcut_v1"]),item("source",["apple_health"])]+[item(k,[ref]) for k,ref in fields]
acts.append(comment("Send them to Xclr. Nothing else leaves your phone."))
dl_u=U()
acts.append(act("is.workflow.actions.downloadurl",{
  "UUID":dl_u,"ShowHeaders":True,"WFHTTPMethod":"POST","WFHTTPBodyType":"JSON",
  "WFURL":tok(["https://xclr.vercel.app/api/health/sync"]),
  "WFHTTPHeaders":{"Value":{"WFDictionaryFieldValueItems":[item("Authorization",["Bearer ",("Text",key_u)])]},"WFSerializationType":"WFDictionaryFieldValue"},
  "WFJSONValues":{"Value":{"WFDictionaryFieldValueItems":items},"WFSerializationType":"WFDictionaryFieldValue"},
}))
wf={"WFWorkflowActions":acts,"WFWorkflowClientVersion":"2607.0.2","WFWorkflowMinimumClientVersion":900,"WFWorkflowMinimumClientVersionString":"900",
    "WFWorkflowIcon":{"WFWorkflowIconGlyphNumber":59511,"WFWorkflowIconStartColor":4292093695},
    "WFWorkflowImportQuestions":Q,"WFWorkflowInputContentItemClasses":[],"WFWorkflowOutputContentItemClasses":[],
    "WFWorkflowHasOutputFallback":False,"WFWorkflowHasShortcutInputVariables":False,"WFWorkflowTypes":[],"WFQuickActionSurfaces":[],"WFWorkflowName":"Xclr Sync"}
out=sys.argv[1]
with open(out+".xml","wb") as f: plistlib.dump(wf,f,fmt=plistlib.FMT_XML)
with open(out+".shortcut","wb") as f: plistlib.dump(wf,f,fmt=plistlib.FMT_BINARY)
print("ok",len(acts))
