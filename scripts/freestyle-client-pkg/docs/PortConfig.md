# PortConfig


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**port** | **int** |  | 
**target_port** | **int** |  | 

## Example

```python
from freestyle_client.models.port_config import PortConfig

# TODO update the JSON string below
json = "{}"
# create an instance of PortConfig from a JSON string
port_config_instance = PortConfig.from_json(json)
# print the JSON string representation of the object
print(PortConfig.to_json())

# convert the object into a dict
port_config_dict = port_config_instance.to_dict()
# create an instance of PortConfig from a dict
port_config_from_dict = PortConfig.from_dict(port_config_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


