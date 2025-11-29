# PortMapping


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**port** | **int** |  | 
**target_port** | **int** |  | 

## Example

```python
from freestyle_client.models.port_mapping import PortMapping

# TODO update the JSON string below
json = "{}"
# create an instance of PortMapping from a JSON string
port_mapping_instance = PortMapping.from_json(json)
# print the JSON string representation of the object
print(PortMapping.to_json())

# convert the object into a dict
port_mapping_dict = port_mapping_instance.to_dict()
# create an instance of PortMapping from a dict
port_mapping_from_dict = PortMapping.from_dict(port_mapping_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


