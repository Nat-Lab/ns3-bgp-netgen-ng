import React, { Component } from 'react';
import Form from 'react-jsonschema-form';
import schema from '../../res/netgen-conf-schema';
import NetGen from '../netgen';
import Beautify from 'json-beautify';
import {UnControlled as CodeMirror} from 'react-codemirror2';
import Debounce from 'debounce';

import 'bootstrap/dist/css/bootstrap.css';
import 'codemirror/lib/codemirror.css';

require('codemirror/mode/javascript/javascript');
require('codemirror/mode/clike/clike')

class App extends Component {
    constructor(props) {
        super(props);
        this.state = {
            data: {},
            errors: 'Compiler ready. Click "Compile to JSON" to check for errors.',
            code: ''
        };
        this.buffer = '{}';
    }

    render() {
        return (
            <div className="row">
                <div className="col-md-8 col-sm-12 editor">
                <legend>editor</legend>
                    <Form 
                        schema={schema} 
                        onChange={data => {
                            this.setState({data: data.formData});
                        }}
                        formData={this.state.data} 
                    />
                </div>
                <div className="col-md-4 col-sm-12 right-panel">
                    <legend>JSON</legend>
                    <CodeMirror
                        className="code"
                        value={Beautify(this.state.data, null, 4, 80)}
                        options={{mode: 'javascript', theme: 'default', lineNumbers: true}} 
                        onChange={(editor, data, value) => {
                            this.buffer = value;
                        }}
                    />
                    <button 
                        type="button" 
                        className="ctrl_but"
                        onClick={() => {
                            try {
                                var import_data = JSON.parse(this.buffer);
                                this.setState({data: import_data});
                            } catch (e) {
                                this.setState({errors: e.toString()});
                            }
                        }}
                    >Load JSON to editor</button>
                    <legend>script</legend>
                    <CodeMirror
                        className="code"
                        value={this.state.code}
                        options={{mode: 'clike', theme: 'default', lineNumbers: true, readOnly: true}} 
                        
                    />
                    <button 
                        type="button" 
                        className="ctrl_but"
                        onClick={() => {
                            try {
                                var obj = JSON.parse(this.buffer);
                                var rslt = NetGen.generate(obj);
                                if (rslt.ok) {
                                    this.setState({errors: 'No problems has been detected so far.', code: rslt.code});
                                } else this.setState({errors: rslt.errors.join('\n')});
                            } catch (e) {
                                this.setState({errors: e.toString()});
                            }
                        }}
                    >Compile from JSON</button>
                    <button 
                        type="button" 
                        className="ctrl_but"
                        onClick={() => {
                            try {
                                var obj = JSON.parse(this.buffer);
                                var rslt = NetGen.generate(obj);
                                if (rslt.ok) {
                                    this.setState({errors: 'No problems has been detected so far.'});
                                    var blob = new Blob([rslt.code], {type: 'text/plain'});
                                    var anchor = document.createElement('a');
                                    anchor.download = 'script.cc';
                                    anchor.href = (window.webkitURL || window.URL).createObjectURL(blob);
                                    anchor.dataset.downloadurl = ['text/plain', anchor.download, anchor.href].join(':');
                                    anchor.click();
                                    anchor.remove();
                                } else this.setState({errors: rslt.errors.join('\n')});
                            } catch (e) {
                                this.setState({errors: e.toString()});
                            }
                        }}
                    >Download script</button>
                    <button 
                        type="button" 
                        className="ctrl_but"
                        onClick={() => {
                            var json = JSON.stringify(this.state.data);    
                            var blob = new Blob([json], {type: 'text/plain'});
                            var anchor = document.createElement('a');
                            anchor.download = 'configuration.json';
                            anchor.href = (window.webkitURL || window.URL).createObjectURL(blob);
                            anchor.dataset.downloadurl = ['text/plain', anchor.download, anchor.href].join(':');
                            anchor.click();
                            anchor.remove();
                        }}
                    >Download JSON</button>
                    <pre>{this.state.errors}</pre>
                </div>
            </div>
        );
    }
}

export default App;