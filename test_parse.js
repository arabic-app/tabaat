const { JSDOM } = require("jsdom");
const dom = new JSDOM(`
    <div class="dynamic-row" id="row1">
        <input type="number" class="md-input ed-volumes" value="12">
    </div>
`);
const document = dom.window.document;
const row = document.getElementById('row1');
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const volsInput = $('.ed-volumes', row);
console.log("Found:", !!volsInput);
if (volsInput) {
    console.log("Value:", volsInput.value);
    console.log("Parsed:", parseInt(volsInput.value));
}
