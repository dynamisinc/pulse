/* Provider-wrapped COBRA components for use inside the DC template.
   Each export mounts CobraThemeProvider so the Cadence palette resolves,
   then the requested component. Children pass through. */
function makeWrapped(name) {
  return function CobraWrapped(props) {
    const DS = window.CadenceDS || {};
    const Provider = DS.CobraThemeProvider;
    const Comp = DS[name];
    if (!Provider || !Comp) return null;
    const { children, ...rest } = props;
    return React.createElement(Provider, null, React.createElement(Comp, rest, children));
  };
}
window.CX = {
  Primary: makeWrapped('CobraPrimaryButton'),
  Secondary: makeWrapped('CobraSecondaryButton'),
  Delete: makeWrapped('CobraDeleteButton'),
  Link: makeWrapped('CobraLinkButton'),
  Icon: makeWrapped('CobraIconButton'),
  Text: makeWrapped('CobraTextField'),
  Radio: makeWrapped('CobraRadio'),
  Checkbox: makeWrapped('CobraCheckbox'),
};
